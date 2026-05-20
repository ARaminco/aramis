import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, getSetting, deleteSetting } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { runAgent, saveMessage, loadHistory } from '../services/agent.js';
import { executeTool } from '../services/tools.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

// List chats
chatRouter.get('/', (req, res) => {
  const chats = db.prepare(`
    SELECT id, title, created_at, updated_at,
      (SELECT content FROM messages WHERE chat_id = chats.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_user
    FROM chats ORDER BY updated_at DESC
  `).all();
  res.json({ chats });
});

// Create a chat
chatRouter.post('/', (req, res) => {
  const id = nanoid();
  const title = (req.body?.title || 'گفتگوی جدید').slice(0, 120);
  const now = Date.now();
  db.prepare('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
  res.json({ id, title, created_at: now, updated_at: now });
});

// Rename / delete a chat
chatRouter.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(title.slice(0, 120), Date.now(), id);
  if (r.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

chatRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM chats WHERE id = ?').run(id);
  deleteSetting(`pending_ask:${id}`);
  res.json({ ok: true });
});

// Load chat (messages)
chatRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const chat = db.prepare('SELECT id, title, created_at, updated_at FROM chats WHERE id = ?').get(id);
  if (!chat) return res.status(404).json({ error: 'not found' });
  const msgs = db.prepare(`
    SELECT id, role, content, tool_calls, tool_call_id, name, created_at
    FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC
  `).all(id);
  const messages = msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
    tool_call_id: m.tool_call_id,
    name: m.name,
    created_at: m.created_at,
  }));
  const pending = getSetting(`pending_ask:${id}`);
  res.json({ chat, messages, pending_ask: pending || null });
});

// Send a message and stream the agent reply via SSE
chatRouter.post('/:id/stream', (req, res, next) => {
  try {
  const { id } = req.params;
  const { content, ask_response, approval } = req.body || {};
  const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(id);
  if (!chat) return res.status(404).json({ error: 'not found' });

  // SSE setup
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // IMPORTANT: do NOT use `req.on('close', ...)` here — in modern Node `req` emits
  // 'close' as soon as the request body is fully consumed, which happens *before*
  // the agent loop starts. That would abort the upstream AI call instantly.
  // Use `res.on('close')` and only abort when the response was closed *before* we
  // finished writing it (i.e. the client actually disconnected mid-stream).
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const writer = {
    send(event, data) {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    },
  };

  // If we are answering an ask_user prompt: attach the answer as a tool result.
  const pending = getSetting(`pending_ask:${id}`);
  const pendingApproval = getSetting(`pending_approval:${id}`);

  if (ask_response !== undefined && pending) {
    saveMessage(id, {
      role: 'tool',
      tool_call_id: pending.tool_call_id,
      name: 'ask_user',
      content: JSON.stringify({ ok: true, answer: String(ask_response) }),
    });
    deleteSetting(`pending_ask:${id}`);
    writer.send('user_replied', { answer: '(sensitive)' });
  } else if (approval && pendingApproval && pendingApproval.tool_call_id === approval.tool_call_id) {
    // User approved or denied a tool call. Either way we synthesise a tool result
    // so the conversation stays valid (every tool_call needs a tool result).
    const { tool_call_id, name, args } = pendingApproval;
    deleteSetting(`pending_approval:${id}`);

    (async () => {
      let result;
      if (approval.approved) {
        writer.send('phase', { phase: 'tool_running', tool: name });
        writer.send('tool_running', { id: tool_call_id, name });
        try {
          result = await executeTool(name, args, {
            onChunk: (stream, text) => {
              try { writer.send('tool_output', { id: tool_call_id, stream, text }); } catch {}
            },
          });
          if (result == null) result = { ok: false, error: 'tool returned no result' };
        } catch (err) {
          result = { ok: false, error: err?.message || String(err) };
        }
      } else {
        result = { ok: false, error: 'User declined to run this command.', declined: true };
      }

      saveMessage(id, {
        role: 'tool',
        tool_call_id,
        name,
        content: JSON.stringify(result),
      });
      writer.send('tool_result', { id: tool_call_id, name, result });

      // Continue the agent loop now that the tool result exists.
      try {
        await runAgent({ chatId: id, writer, signal: controller.signal });
      } catch (err) {
        console.error('[runAgent resume error]', err);
        writer.send('error', { message: err.message || String(err) });
        writer.send('done', {});
      } finally {
        try { res.end(); } catch {}
      }
    })();
    return; // important: bypass the default runAgent at the bottom
  } else if (content && content.trim()) {
    // Regular user message
    saveMessage(id, { role: 'user', content });
    writer.send('user_saved', {});
    // Auto-title if this is the first message
    const count = db.prepare("SELECT COUNT(*) AS c FROM messages WHERE chat_id = ? AND role = 'user'").get(id).c;
    if (count === 1) {
      const title = content.slice(0, 60).replace(/\s+/g, ' ').trim() || 'گفتگوی جدید';
      db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, id);
      writer.send('title_update', { title });
    }
  } else {
    writer.send('error', { message: 'either "content" or "ask_response" is required' });
    writer.send('done', {});
    return res.end();
  }

  runAgent({ chatId: id, writer, signal: controller.signal })
    .catch((err) => {
      console.error('[runAgent error]', err);
      writer.send('error', { message: err.message || String(err) });
      writer.send('done', {});
    })
    .finally(() => {
      try { res.end(); } catch {}
    });
  } catch (err) { next(err); }
});

// History export (raw view of a chat for the user)
chatRouter.get('/:id/history', (req, res) => {
  const { id } = req.params;
  res.json({ messages: loadHistory(id) });
});
