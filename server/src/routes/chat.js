import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, getSetting, deleteSetting } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { runAgent, saveMessage, loadHistory } from '../services/agent.js';
import { executeTool } from '../services/tools.js';
import { runExternalCLI } from '../services/cli-runner.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const VALID_MODES = new Set(['aramis', 'claude', 'codex']);

// List chats
chatRouter.get('/', (req, res) => {
  const chats = db.prepare(`
    SELECT id, title, created_at, updated_at, mode, external_session_id, cwd, pinned,
      (SELECT content FROM messages WHERE chat_id = chats.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_user
    FROM chats ORDER BY pinned DESC, updated_at DESC
  `).all();
  res.json({ chats });
});

// Create a chat
chatRouter.post('/', (req, res) => {
  const id = nanoid();
  const title = (req.body?.title || 'گفتگوی جدید').slice(0, 120);
  const mode = VALID_MODES.has(req.body?.mode) ? req.body.mode : 'aramis';
  const cwd = req.body?.cwd ? String(req.body.cwd).slice(0, 500) : null;
  const externalSessionId = req.body?.external_session_id ? String(req.body.external_session_id).slice(0, 200) : null;
  const now = Date.now();
  db.prepare(`
    INSERT INTO chats (id, title, created_at, updated_at, mode, external_session_id, cwd, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, title, now, now, mode, externalSessionId, cwd);
  res.json({ id, title, created_at: now, updated_at: now, mode, external_session_id: externalSessionId, cwd, pinned: 0 });
});

// Patch chat metadata: title / mode / cwd / pinned / external_session_id
chatRouter.patch('/:id', (req, res) => {
  const { id } = req.params;
  const fields = req.body || {};
  const sets = [];
  const args = [];
  if (typeof fields.title === 'string') { sets.push('title = ?'); args.push(fields.title.slice(0, 120)); }
  if (typeof fields.mode === 'string' && VALID_MODES.has(fields.mode)) { sets.push('mode = ?'); args.push(fields.mode); }
  if ('cwd' in fields) { sets.push('cwd = ?'); args.push(fields.cwd ? String(fields.cwd).slice(0, 500) : null); }
  if ('external_session_id' in fields) { sets.push('external_session_id = ?'); args.push(fields.external_session_id ? String(fields.external_session_id).slice(0, 200) : null); }
  if ('pinned' in fields) { sets.push('pinned = ?'); args.push(fields.pinned ? 1 : 0); }
  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
  sets.push('updated_at = ?'); args.push(Date.now());
  args.push(id);
  const r = db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  if (r.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

chatRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM chats WHERE id = ?').run(id);
  deleteSetting(`pending_ask:${id}`);
  deleteSetting(`pending_approval:${id}`);
  res.json({ ok: true });
});

// Load chat (messages)
chatRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const chat = db.prepare('SELECT id, title, created_at, updated_at, mode, external_session_id, cwd, pinned FROM chats WHERE id = ?').get(id);
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
  const { content, ask_response, approval, mode: modeOverride } = req.body || {};
  const chat = db.prepare('SELECT id, mode, external_session_id, cwd FROM chats WHERE id = ?').get(id);
  if (!chat) return res.status(404).json({ error: 'not found' });

  // Persist a mode override on the chat if the client sent one (allows the
  // composer's mode-switcher to take effect on the very next message).
  let effectiveMode = chat.mode || 'aramis';
  if (modeOverride && VALID_MODES.has(modeOverride) && modeOverride !== effectiveMode) {
    db.prepare('UPDATE chats SET mode = ?, updated_at = ? WHERE id = ?').run(modeOverride, Date.now(), id);
    effectiveMode = modeOverride;
  }

  // SSE setup
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

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
    return; // bypass the default runAgent below
  } else if (content && content.trim()) {
    saveMessage(id, { role: 'user', content });
    writer.send('user_saved', {});
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

  // Dispatch by mode
  if (effectiveMode === 'aramis') {
    runAgent({ chatId: id, writer, signal: controller.signal })
      .catch((err) => {
        console.error('[runAgent error]', err);
        writer.send('error', { message: err.message || String(err) });
        writer.send('done', {});
      })
      .finally(() => { try { res.end(); } catch {} });
  } else {
    // External CLI (Claude Code / Codex / ...). We stream their output as a
    // single assistant message, then save it. Tool-use cards are emitted live;
    // we materialize them into the DB via a pseudo-message so reloads show them.
    runExternalCLIAsMessage({
      chatId: id,
      writer,
      tool: effectiveMode,
      prompt: content || '',
      cwd: chat.cwd || process.cwd(),
      sessionId: chat.external_session_id || null,
      signal: controller.signal,
    })
      .catch((err) => {
        console.error('[runExternalCLI error]', err);
        writer.send('error', { message: err.message || String(err) });
        writer.send('done', {});
      })
      .finally(() => { try { res.end(); } catch {} });
  }
  } catch (err) { next(err); }
});

// History export (raw view of a chat for the user)
chatRouter.get('/:id/history', (req, res) => {
  const { id } = req.params;
  res.json({ messages: loadHistory(id) });
});

// ----------------------------------------------------------------------------
// External-CLI message capture: we tee the SSE stream into a synthetic
// assistant message so that the chat history persists after the stream ends.

async function runExternalCLIAsMessage({ chatId, writer, tool, prompt, cwd, sessionId, signal }) {
  const buffered = {
    text: '',
    tool_calls: [],
    tool_results: [],  // {id, name, result}
    cli_session_id: sessionId || null,
  };

  const teeWriter = {
    send(event, data) {
      writer.send(event, data);
      switch (event) {
        case 'text_delta':
          buffered.text += data.text || '';
          break;
        case 'tool_call': {
          const existing = buffered.tool_calls.find((c) => c.id === data.id);
          if (existing) {
            // Subsequent re-emission (e.g. with resolved args) — merge.
            existing.function.name = data.name || existing.function.name;
            existing.function.arguments = JSON.stringify(data.args || {});
          } else {
            buffered.tool_calls.push({
              id: data.id,
              type: 'function',
              function: { name: data.name, arguments: JSON.stringify(data.args || {}) },
            });
          }
          break;
        }
        case 'tool_result':
          buffered.tool_results.push({ id: data.id, name: data.name, result: data.result });
          break;
        case 'cli_meta':
          if (data.session_id) buffered.cli_session_id = data.session_id;
          break;
      }
    },
  };

  await runExternalCLI({ tool, writer: teeWriter, prompt, cwd, sessionId, signal });

  // Persist the assistant turn so the chat can be reopened later.
  const assistantMsg = {
    role: 'assistant',
    content: buffered.text,
  };
  if (buffered.tool_calls.length) assistantMsg.tool_calls = buffered.tool_calls;
  saveMessage(chatId, assistantMsg);

  for (const tr of buffered.tool_results) {
    saveMessage(chatId, {
      role: 'tool',
      tool_call_id: tr.id,
      name: tr.name,
      content: JSON.stringify(tr.result ?? {}),
    });
  }

  // Remember the external session id so the next turn can resume the CLI.
  if (buffered.cli_session_id) {
    db.prepare('UPDATE chats SET external_session_id = ?, updated_at = ? WHERE id = ?')
      .run(buffered.cli_session_id, Date.now(), chatId);
  }
}
