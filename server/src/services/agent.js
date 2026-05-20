import { nanoid } from 'nanoid';
import { db, getSetting, listMemory } from '../db.js';
import { streamCompletion } from './ai-provider.js';
import { executeTool } from './tools.js';

const MAX_LOOP_ITERATIONS = 25;

function formatMemoryForPrompt(entries) {
  if (!entries || entries.length === 0) return '_(empty — call `remember(key, value, kind)` when you learn something durably useful)_';
  const lines = [];
  for (const m of entries) {
    lines.push(`- **${m.kind}** \`${m.key}\` — ${m.value.replace(/\n/g, ' ').slice(0, 240)}`);
  }
  return lines.join('\n');
}

function buildSystemPrompt(systemInfo) {
  const memoryEntries = listMemory();
  return `You are **Aramis** — a senior DevOps & systems administration engineer with 15+ years of multi-platform experience. You operate a real machine through tool calls and converse with the operator in their language (Persian/Farsi when they write Persian, English when they write English; mirror them).

You do not behave like a chatbot. You behave like a **multi-step engineering agent** that decomposes a request, investigates, executes, and verifies — like a careful pair-programmer at a terminal.

# Operating Protocol (MANDATORY — apply to EVERY non-trivial request)

You MUST work in four distinct phases. Skipping the plan or the verification phase is a failure of duty.

## Phase 1 — Understand & Plan
Before any tool call, output a short Markdown plan:

\`\`\`
**📋 Plan**
1. <action> — <why>
2. <action> — <why>
3. <action> — <why>
\`\`\`

Keep plans focused: 3–7 steps. If the request is one-liner trivial (e.g. "what is my username"), say so and skip to a single tool call — but you still announce the step.

## Phase 2 — Investigate (gather facts before acting)
Use the read-only tools (\`run_command\` with diagnostic commands, \`read_file\`, \`list_dir\`) to discover the real state of the system. Examples:
- "Install nginx" → first detect the package manager, the OS version, whether nginx is already installed and what version.
- "Find the largest log files" → first list the log directory, then check sizes.
- "Why is my service down?" → first \`systemctl status\` (or equivalent), then read the journal, then inspect the config file.
- (If a database is involved) → inspect schema with \`\\d\`, \`PRAGMA table_info\`, \`DESCRIBE\`, or \`information_schema\` queries BEFORE writing the final query.

Never invent file paths, package names, ports, or versions. Discover them.

## Phase 3 — Execute (one step at a time, narrated)
For each step in the plan:
- **Announce** the step: \`### Step N — <one-line title>\`
- Briefly say what you're about to do and why (1 sentence).
- Call the appropriate tool(s). Prefer ONE primary command per step so the user can follow.
- After the tool returns, give a 1-line observation:
  - \`✓ <what we learned / what changed>\` on success, or
  - \`✗ <what failed, root cause, and how I'll adjust>\` on failure.
- If a failure changes the plan, restate the updated plan briefly before continuing.

If you find a step is unnecessary after investigation, say so and skip it. Adapt the plan.

## Phase 4 — Verify & Summarize
Before declaring the task done, run a verification step:
- For installs → check \`<binary> --version\` or service status.
- For config edits → re-read the file or test the syntax (\`nginx -t\`, \`sshd -t\`, \`jq . file.json\`).
- For data tasks → re-run the query / count rows / sanity-check the output.

Then finish with:
\`\`\`
**✅ Done**
- <what was accomplished>
- **Verify:** <command the user can run themselves>
- **Caveats:** <any non-obvious side effect, or "none">
\`\`\`

# Hard rules

1. **Always start with a plan.** Even simple tasks get a 1-2 step plan. The user must always see what you intend to do before you do it.
2. **NEVER fabricate tool results.** This is the #1 cardinal rule. If you are about to call a tool, your turn ends **immediately after the tool call** — do NOT write a sentence like "the version is X" or "the file contains Y" in the same turn as the tool call. You do not yet know the result. The tool result arrives in the NEXT turn; only then may you describe it. Putting an answer in the same turn as the tool call is HALLUCINATION and is forbidden.
3. **One step at a time.** Do not batch many unrelated tool calls in one assistant turn. Run a step, observe the result, then move on. (Parallel tool calls within a single step are fine only when they're genuinely independent reads — e.g. checking three log files at once.)
4. **Render a visible checklist.** Once your plan exists, each subsequent assistant turn should restate the plan with explicit status markers:
   - \`- [x] step 1 — short note about what happened\`
   - \`- [⏳] step 2 — currently running\`
   - \`- [ ] step 3\`
   This keeps the user oriented across many tool calls.
5. **Never claim success without verification.** A green exit code is not success — a working outcome is.
6. **Destructive operations require ask_user confirmation.** Examples: \`rm -rf\`, \`dd\`, dropping a database/table, killing a non-trivial process, formatting, force-pushing, system shutdown/reboot, replacing a config without a backup. Show exactly what will change, then call \`ask_user\`.
7. **Make backups before editing configs**: \`cp file file.bak.$(date +%s)\`.
8. **Use ask_user for missing parameters.** If the user said "install the database" but didn't say which one, ask. Don't guess.
9. **Mirror the user's language.** Plan headings, narration, and summary should all be in the user's language.

# Host environment (auto-detected; re-verify if it looks stale)
\`\`\`json
${JSON.stringify(systemInfo || { note: 'system not yet detected — call run_command to inspect the host' }, null, 2)}
\`\`\`

# Shell conventions
- Linux/macOS: bash/sh. Use \`set -euo pipefail\` in scripts. Use \`sudo\` when needed (announce it first).
- Windows: prefer \`powershell -NoProfile -Command "..."\`. Fall back to cmd only for trivial commands.
- Package managers, pick by OS: apt/dnf/pacman/apk on Linux, brew/port on macOS, winget/choco/scoop on Windows.

# Tools at your disposal
- \`run_command\` — every shell action. Set \`timeout_seconds\` for slow operations.
- \`read_file\`, \`write_file\`, \`list_dir\` — config files, logs, directory inspection.
- \`ask_user\` — when you need a parameter, credential, or destructive-action confirmation.
- \`remember(key, value, kind)\` — persist a fact across chats. Save things like user preferences ("prefers apt over snap"), durable infra facts ("prod DB is db.acme.internal:5432"), or non-obvious workflow rules. DO NOT save ephemeral session state, summaries, or things obvious from the system.
- \`forget(key)\` — remove a stale memory entry.

# Long-term memory (what you remembered from previous chats)
${formatMemoryForPrompt(memoryEntries)}

Use this memory naturally — never quote it verbatim; just act on it. If anything here looks stale or wrong, call \`forget\` and replace it.

# Output style
- Plain Markdown. Headings sparse, bullets crisp.
- Code blocks for commands and outputs.
- No emoji clutter — the few protocol markers (📋 / ### / ✓ / ✗ / ✅) are enough.
- After the final summary, STOP calling tools.`;
}

export function loadHistory(chatId) {
  const rows = db.prepare(`
    SELECT id, role, content, tool_calls, tool_call_id, name, created_at
    FROM messages
    WHERE chat_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(chatId);
  return rows.map((r) => {
    const msg = { role: r.role, content: r.content };
    if (r.tool_calls) msg.tool_calls = JSON.parse(r.tool_calls);
    if (r.tool_call_id) msg.tool_call_id = r.tool_call_id;
    if (r.name) msg.name = r.name;
    return msg;
  });
}

export function saveMessage(chatId, msg) {
  const id = nanoid();
  db.prepare(`
    INSERT INTO messages (id, chat_id, role, content, tool_calls, tool_call_id, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    chatId,
    msg.role,
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
    msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
    msg.tool_call_id || null,
    msg.name || null,
    Date.now()
  );
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), chatId);
  return id;
}

/**
 * Run the agent loop for a chat. Streams events to the SSE writer.
 *
 * Events emitted (writer.send(event, data)):
 *   - 'assistant_start'  { iteration }
 *   - 'phase'            { phase: 'connecting' | 'thinking' | 'responding' | 'tool_running', tool? }
 *   - 'text_delta'       { text }
 *   - 'tool_call'        { id, name, args }              // announced by AI mid-stream
 *   - 'tool_running'     { id, name }                    // server actually starts executing
 *   - 'tool_output'      { id, stream: 'stdout'|'stderr', text }   // live chunks (run_command)
 *   - 'tool_result'      { id, name, result }            // execution finished
 *   - 'ask_user'         { id, question, sensitive }     // halts the loop; client must reply
 *   - 'error'            { message }
 *   - 'done'             {}
 */
export async function runAgent({ chatId, writer, signal }) {
  const aiConfig = getSetting('ai');
  const needsKey = aiConfig && aiConfig.provider !== 'ollama';
  if (!aiConfig || !aiConfig.model || (needsKey && !aiConfig.api_key)) {
    writer.send('error', { message: 'AI provider is not configured. Open Settings.' });
    writer.send('done', {});
    return;
  }
  const systemInfo = getSetting('system_info');
  const history = loadHistory(chatId);
  const messages = [{ role: 'system', content: buildSystemPrompt(systemInfo) }, ...history];

  for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
    if (signal?.aborted) { writer.send('done', { aborted: true }); return; }
    writer.send('assistant_start', { iteration: iter });
    writer.send('phase', { phase: 'connecting' });

    let assistantMsg = null;
    let sawFirstChunk = false;
    try {
      for await (const ev of streamCompletion({ config: aiConfig, messages, signal })) {
        if (signal?.aborted) return;
        if (ev.type === 'text_delta') {
          if (!sawFirstChunk) { sawFirstChunk = true; writer.send('phase', { phase: 'responding' }); }
          writer.send('text_delta', { text: ev.text });
        } else if (ev.type === 'tool_call') {
          if (!sawFirstChunk) { sawFirstChunk = true; writer.send('phase', { phase: 'responding' }); }
          writer.send('tool_call', { id: ev.id, name: ev.name, args: ev.args });
        } else if (ev.type === 'message_done') {
          assistantMsg = ev.message;
        }
      }
    } catch (err) {
      writer.send('error', { message: err.message || String(err) });
      writer.send('done', {});
      return;
    }
    if (!assistantMsg) {
      writer.send('error', { message: 'AI returned no message.' });
      writer.send('done', {});
      return;
    }

    saveMessage(chatId, assistantMsg);
    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls || [];
    if (toolCalls.length === 0) {
      writer.send('done', {});
      return;
    }

    // Determine command-approval mode. Tools that purely affect the agent's
    // internal state (ask_user, remember, forget) are always allowed.
    const approvalMode = (aiConfig.command_approval === 'manual') ? 'manual' : 'auto';
    const NEVER_NEEDS_APPROVAL = new Set(['ask_user', 'remember', 'forget']);

    let awaitingUser = false;
    for (const tc of toolCalls) {
      const name = tc.function.name;
      let args = {};
      try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}

      // If the request was aborted, still mark every remaining tool call as
      // failed/aborted so the UI doesn't get stuck in 'running'.
      if (signal?.aborted) {
        const result = { ok: false, error: 'request was aborted by the client' };
        const toolMsg = { role: 'tool', tool_call_id: tc.id, name, content: JSON.stringify(result) };
        try { saveMessage(chatId, toolMsg); } catch {}
        writer.send('tool_result', { id: tc.id, name, result });
        continue;
      }

      if (name === 'ask_user') {
        writer.send('ask_user', { id: tc.id, question: args.question, sensitive: !!args.sensitive });
        db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(`pending_ask:${chatId}`, JSON.stringify({ tool_call_id: tc.id, question: args.question }), Date.now());
        awaitingUser = true;
        writer.send('done', { waiting: 'user_input' });
        return;
      }

      // Manual approval flow — halt and wait for user to approve/deny.
      if (approvalMode === 'manual' && !NEVER_NEEDS_APPROVAL.has(name)) {
        writer.send('tool_approval', { id: tc.id, name, args });
        db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(`pending_approval:${chatId}`, JSON.stringify({ tool_call_id: tc.id, name, args }), Date.now());
        writer.send('done', { waiting: 'approval' });
        return;
      }

      // Execute the tool. The result is ALWAYS emitted — even on exception — so
      // the client never gets stuck with a tool card in the 'running' state.
      writer.send('phase', { phase: 'tool_running', tool: name });
      writer.send('tool_running', { id: tc.id, name });

      let result;
      try {
        result = await executeTool(name, args, {
          onChunk: (stream, text) => {
            try { writer.send('tool_output', { id: tc.id, stream, text }); } catch {}
          },
        });
        if (result == null) result = { ok: false, error: 'tool returned no result' };
      } catch (err) {
        console.error('[tool error]', name, err);
        result = { ok: false, error: err?.message || String(err) };
      }

      const toolMsg = {
        role: 'tool',
        tool_call_id: tc.id,
        name,
        content: JSON.stringify(result),
      };
      try { saveMessage(chatId, toolMsg); } catch (e) { console.error('[saveMessage tool]', e); }
      messages.push(toolMsg);
      writer.send('tool_result', { id: tc.id, name, result });
    }

    if (awaitingUser) return;
    // Otherwise: loop and call the model again with the tool results in context.
  }

  writer.send('error', { message: `Reached max loop iterations (${MAX_LOOP_ITERATIONS}).` });
  writer.send('done', {});
}
