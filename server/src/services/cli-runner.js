// CLI runner — integrates external coding-agent CLIs (Claude Code, Codex, Gemini, Cursor)
// into Aramis. Each adapter spawns the CLI as a child process and translates its
// output into the same SSE events Aramis already emits, so the chat UI is identical
// for every backend.
//
// Output protocol (same as agent.js):
//   - 'assistant_start'  { iteration }
//   - 'phase'            { phase, tool? }
//   - 'text_delta'       { text }
//   - 'tool_call'        { id, name, args }
//   - 'tool_running'     { id, name }
//   - 'tool_output'      { id, stream: 'stdout'|'stderr', text }
//   - 'tool_result'      { id, name, result }
//   - 'cli_meta'         { session_id?, model?, cwd? }
//   - 'error'            { message }
//   - 'done'             {}

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveCliRuntime } from './cli-config.js';
import { findBin, getVersion } from './path-discover.js';

function safeWhich(bin) { return findBin(bin); }
function safeVersion(bin, args = ['--version']) { return getVersion(bin, args); }

/**
 * Returns a list of supported coding-agent CLIs and whether each is installed.
 */
export function detectCLIs() {
  const list = [
    { id: 'claude', name: 'Claude Code', bin: 'claude', version_args: ['--version'] },
    { id: 'codex',  name: 'OpenAI Codex', bin: 'codex',  version_args: ['--version'] },
    { id: 'gemini', name: 'Gemini CLI',   bin: 'gemini', version_args: ['--version'] },
    { id: 'cursor', name: 'Cursor CLI',   bin: 'cursor-agent', version_args: ['--version'] },
  ];
  return list.map((c) => {
    const path_ = safeWhich(c.bin);
    return {
      id: c.id,
      name: c.name,
      bin: c.bin,
      installed: !!path_,
      path: path_,
      version: path_ ? safeVersion(c.bin, c.version_args) : null,
    };
  });
}

// ----------------------------------------------------------------------------
// Claude Code session discovery
// Claude Code stores per-project sessions at:  ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// where <encoded-cwd> replaces "/" with "-" (legacy) and recent versions use a
// safer scheme. We accept either: just glob all .jsonl files under projects/.

function encodeClaudeCwd(cwd) {
  // Claude Code's legacy slug — replace path separators with dashes.
  return cwd.replace(/\\/g, '/').replace(/[/]/g, '-');
}

export async function listClaudeSessions({ cwd } = {}) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const projects = await fs.readdir(projectsDir, { withFileTypes: true });
    const out = [];
    for (const d of projects) {
      if (!d.isDirectory()) continue;
      const projDir = path.join(projectsDir, d.name);
      let files;
      try { files = await fs.readdir(projDir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(projDir, f);
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        const sessionId = f.replace(/\.jsonl$/, '');
        let preview = null;
        try {
          const buf = await fs.readFile(full, 'utf8');
          for (const line of buf.split('\n').slice(0, 6)) {
            if (!line) continue;
            try {
              const ev = JSON.parse(line);
              // Look for the first user-text content
              const c = ev?.message?.content;
              if (Array.isArray(c)) {
                for (const part of c) {
                  if (part?.type === 'text' && part.text) { preview = String(part.text).slice(0, 120); break; }
                }
              } else if (typeof c === 'string') { preview = c.slice(0, 120); }
              if (preview) break;
            } catch {}
          }
        } catch {}
        out.push({
          tool: 'claude',
          session_id: sessionId,
          project: d.name,
          file: full,
          size: stat.size,
          updated_at: stat.mtimeMs,
          preview: preview || `(claude session ${sessionId.slice(0, 8)})`,
        });
      }
    }
    // newest first
    out.sort((a, b) => b.updated_at - a.updated_at);
    if (cwd) {
      const slug = encodeClaudeCwd(cwd);
      // Surface matching project first
      out.sort((a, b) => Number(b.project === slug) - Number(a.project === slug));
    }
    return out;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function listCodexSessions() {
  const candidates = [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.config', 'codex', 'sessions'),
  ];
  for (const dir of candidates) {
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      const out = [];
      for (const f of files) {
        if (!f.isFile()) continue;
        if (!(f.name.endsWith('.json') || f.name.endsWith('.jsonl'))) continue;
        const full = path.join(dir, f.name);
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        out.push({
          tool: 'codex',
          session_id: f.name.replace(/\.(json|jsonl)$/, ''),
          file: full,
          size: stat.size,
          updated_at: stat.mtimeMs,
          preview: `(codex session ${f.name.slice(0, 10)})`,
        });
      }
      out.sort((a, b) => b.updated_at - a.updated_at);
      return out;
    } catch { /* try next */ }
  }
  return [];
}

// ----------------------------------------------------------------------------
// Claude Code adapter — runs claude in stream-json mode and translates events.
//
// Command:
//   claude --print --output-format stream-json --include-partial-messages \
//          --verbose [--resume <session_id>] [--model <model>] <prompt>
//
// stream-json events (line-delimited JSON):
//   {type:"system", subtype:"init", session_id, model, cwd, tools, ...}
//   {type:"assistant", message:{content:[{type:"text",text:"..."}, {type:"tool_use", id, name, input}], ...}}
//   {type:"user", message:{content:[{type:"tool_result", tool_use_id, content:"..."}]}}
//   {type:"stream_event", event:{type:"content_block_delta", delta:{type:"text_delta", text:"..."}}}
//   {type:"result", subtype:"success"|"error_*", duration_ms, total_cost_usd, ...}

function lineReader(stream, onLine) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on('end', () => { if (buf.trim()) onLine(buf); });
}

const SEEN_TEXT_BLOCK = new WeakMap();

export async function runClaudeCode({ writer, prompt, cwd, sessionId, model, signal }) {
  const bin = findBin('claude');
  if (!bin) {
    writer.send('error', { message: 'Claude Code CLI (`claude`) was not found. Open the Agent-CLI manager (⌘I) and install it.' });
    writer.send('done', {});
    return { ok: false };
  }
  // Guard against empty prompts — claude --print "" exits without output and
  // the UI ends up with a dead silent assistant bubble.
  if (!prompt || !String(prompt).trim()) {
    writer.send('error', { message: 'Claude Code requires a non-empty prompt. Type a message and try again.' });
    writer.send('done', {});
    return { ok: false };
  }
  const runtime = resolveCliRuntime('claude');
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--dangerously-skip-permissions', // we already gate destructive ops at the chat UI level
  ];
  if (sessionId) args.push('--resume', sessionId);
  const effectiveModel = model || runtime.model;
  if (effectiveModel) args.push('--model', effectiveModel);
  if (runtime.extraArgs && runtime.extraArgs.length) args.push(...runtime.extraArgs);
  args.push(prompt);

  writer.send('assistant_start', { iteration: 0 });
  writer.send('phase', { phase: 'connecting' });
  // Echo the spawn so the user (and future debugging) can see exactly what's about to run.
  writer.send('text_delta', { text: `_starting Claude Code (model: ${effectiveModel || 'default'}${sessionId ? `, resuming ${sessionId.slice(0,8)}…` : ''})_\n\n` });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, CLAUDE_DISABLE_TELEMETRY: '1', ...runtime.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      writer.send('error', { message: `Failed to launch claude: ${e.message}` });
      writer.send('done', {});
      return resolve({ ok: false });
    }

    let resultSessionId = sessionId || null;
    let sawAnyOutput = false;
    const activeTools = new Set();   // tool_use_ids currently in flight
    const toolNameById = new Map();

    const onLine = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      sawAnyOutput = true;

      if (ev.type === 'system' && ev.subtype === 'init') {
        if (ev.session_id) resultSessionId = ev.session_id;
        writer.send('cli_meta', {
          session_id: ev.session_id,
          model: ev.model,
          cwd: ev.cwd,
          tools: ev.tools,
        });
        writer.send('phase', { phase: 'thinking' });
        return;
      }

      // Partial deltas as the assistant streams text/tool args
      if (ev.type === 'stream_event') {
        const e = ev.event || {};
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          writer.send('phase', { phase: 'responding' });
          writer.send('text_delta', { text: e.delta.text || '' });
          return;
        }
        if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
          const id = e.content_block.id;
          const name = mapClaudeToolName(e.content_block.name);
          toolNameById.set(id, name);
          writer.send('tool_call', { id, name, args: {} });
          activeTools.add(id);
          return;
        }
        if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
          // tool args streaming — we accumulate and emit a single args update on stop
          return;
        }
        return;
      }

      if (ev.type === 'assistant' && ev.message?.content) {
        // Final-form assistant message: any tool_use blocks become 'tool_call' (if not already)
        for (const part of ev.message.content) {
          if (part.type === 'tool_use') {
            const name = mapClaudeToolName(part.name);
            toolNameById.set(part.id, name);
            // Re-emit with the resolved args (overwrites previous empty args)
            writer.send('tool_call', { id: part.id, name, args: claudeArgsToAramis(part.name, part.input) });
            writer.send('tool_running', { id: part.id, name });
            activeTools.add(part.id);
          }
        }
        return;
      }

      if (ev.type === 'user' && ev.message?.content) {
        for (const part of ev.message.content) {
          if (part.type === 'tool_result') {
            const id = part.tool_use_id;
            const name = toolNameById.get(id) || 'tool';
            const text = extractToolResultText(part.content);
            const isError = !!part.is_error;
            const result = isError
              ? { ok: false, error: text }
              : claudeResultToAramis(name, text);
            // Pipe textual output as if it were live so the terminal card renders nicely
            if (name === 'run_command' && text) {
              writer.send('tool_output', { id, stream: isError ? 'stderr' : 'stdout', text });
            }
            writer.send('tool_result', { id, name, result });
            activeTools.delete(id);
          }
        }
        return;
      }

      if (ev.type === 'result') {
        if (ev.session_id) resultSessionId = ev.session_id;
        if (ev.subtype && ev.subtype !== 'success') {
          writer.send('error', { message: `Claude Code: ${ev.subtype}${ev.error ? ` — ${ev.error}` : ''}` });
        }
        writer.send('cli_meta', {
          session_id: resultSessionId,
          duration_ms: ev.duration_ms,
          total_cost_usd: ev.total_cost_usd,
          num_turns: ev.num_turns,
        });
      }
    };

    lineReader(child.stdout, onLine);

    // Surface stderr LIVE so auth failures / progress notes appear immediately
    // instead of vanishing into a silent run that ends with no message.
    let stderrBuf = '';
    let stderrSurfaced = false;
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      stderrBuf += s;
      // Common auth errors: surface them as user-friendly text in the chat.
      if (!stderrSurfaced && /no.*api.*key|not.*authenticated|please.*login|unauthorized|401/i.test(s)) {
        stderrSurfaced = true;
        writer.send('text_delta', { text: `\n**❗ Claude Code authentication needed.**\nRun \`claude login\` in your terminal, or set ANTHROPIC_API_KEY in Settings → Agent CLIs → Configure Claude Code.\n\n` });
      } else if (s.trim()) {
        // Stream other stderr as muted italic text so the user can see what's happening
        writer.send('text_delta', { text: `_${s.trim().replace(/\n/g, ' ')}_\n` });
      }
    });

    const abort = () => { try { child.kill('SIGTERM'); } catch {} };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    child.on('error', (err) => {
      writer.send('error', { message: `claude spawn error: ${err.message}` });
      writer.send('done', {});
      resolve({ ok: false });
    });

    child.on('close', (code) => {
      if (!sawAnyOutput) {
        const detail = stderrBuf.trim() || 'no output and no error — is Claude Code authenticated? Try `claude login` in a terminal.';
        writer.send('error', { message: `Claude Code exited with code ${code}:\n${detail.slice(0, 4000)}` });
      } else if (code !== 0 && stderrBuf.trim()) {
        // Trailing context if we got partial output then failed.
        writer.send('text_delta', { text: `\n_(claude exited ${code}: ${stderrBuf.trim().slice(0, 400)})_` });
      }
      writer.send('done', { session_id: resultSessionId });
      resolve({ ok: code === 0, session_id: resultSessionId });
    });
  });
}

// Claude Code tool names → Aramis tool taxonomy (purely cosmetic; UI labels)
function mapClaudeToolName(claudeName) {
  switch (claudeName) {
    case 'Bash':       return 'run_command';
    case 'Read':       return 'read_file';
    case 'Write':      return 'write_file';
    case 'Edit':       return 'edit_file';
    case 'MultiEdit':  return 'edit_file';
    case 'Glob':       return 'glob';
    case 'Grep':       return 'grep';
    case 'LS':         return 'list_dir';
    case 'WebFetch':   return 'web_fetch';
    case 'WebSearch':  return 'web_search';
    case 'TodoWrite':  return 'todo';
    case 'Task':       return 'subagent';
    default:           return claudeName || 'tool';
  }
}

function claudeArgsToAramis(claudeName, input) {
  if (!input || typeof input !== 'object') return input || {};
  switch (claudeName) {
    case 'Bash':       return { command: input.command, cwd: input.cwd, timeout_seconds: input.timeout };
    case 'Read':       return { path: input.file_path, max_bytes: input.limit };
    case 'Write':      return { path: input.file_path, content: input.content };
    case 'Edit':       return { path: input.file_path, edits: input.edits || [{ old: input.old_string, new: input.new_string }] };
    case 'LS':         return { path: input.path };
    case 'Grep':       return { pattern: input.pattern, path: input.path };
    case 'Glob':       return { pattern: input.pattern };
    default:           return input;
  }
}

function extractToolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text || '' : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (content?.text) return content.text;
  try { return JSON.stringify(content); } catch { return String(content); }
}

function claudeResultToAramis(name, text) {
  if (name === 'run_command') {
    // Try to recover exit code if Claude embeds it; otherwise default ok=true.
    return { ok: true, exit_code: 0, stdout: text, stderr: '' };
  }
  if (name === 'read_file') {
    return { ok: true, content: text, size: text.length };
  }
  if (name === 'list_dir') {
    const entries = text.split('\n').filter(Boolean).map((line) => ({
      name: line.replace(/^[-d]\s+/, '').trim(),
      type: line.startsWith('d') ? 'dir' : 'file',
    }));
    return { ok: true, entries };
  }
  return { ok: true, content: text };
}

// ----------------------------------------------------------------------------
// Codex adapter — runs `codex exec` in non-interactive mode.
//
// We treat codex output as opaque text streamed to the chat — codex's
// stdout already carries the assistant text, tool announcements, etc. We
// detect simple "$ command" patterns and surface them in a tool card.

export async function runCodex({ writer, prompt, cwd, sessionId, model, signal }) {
  const bin = findBin('codex');
  if (!bin) {
    writer.send('error', { message: 'Codex CLI (`codex`) was not found. Open the Agent-CLI manager (⌘I) and install it.' });
    writer.send('done', {});
    return { ok: false };
  }
  if (!prompt || !String(prompt).trim()) {
    writer.send('error', { message: 'Codex requires a non-empty prompt. Type a message and try again.' });
    writer.send('done', {});
    return { ok: false };
  }

  const runtime = resolveCliRuntime('codex');
  const args = ['exec'];
  const effectiveModel = model || runtime.model;
  if (effectiveModel) { args.push('-m', effectiveModel); }
  if (sessionId) { args.push('--resume', sessionId); }
  if (runtime.extraArgs && runtime.extraArgs.length) args.push(...runtime.extraArgs);
  args.push('--', prompt);

  writer.send('assistant_start', { iteration: 0 });
  writer.send('phase', { phase: 'connecting' });
  writer.send('text_delta', { text: `_starting Codex (model: ${effectiveModel || 'default'}${sessionId ? `, resuming ${sessionId.slice(0,8)}…` : ''})_\n\n` });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...runtime.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      writer.send('error', { message: `Failed to launch codex: ${e.message}` });
      writer.send('done', {});
      return resolve({ ok: false });
    }

    writer.send('phase', { phase: 'responding' });
    let sawAnyOutput = false;
    let stderrBuf = '';
    let authSurfaced = false;

    child.stdout.on('data', (d) => {
      sawAnyOutput = true;
      writer.send('text_delta', { text: d.toString('utf8') });
    });
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      stderrBuf += s;
      if (!authSurfaced && /no.*api.*key|not.*authenticated|please.*login|unauthorized|401|missing.*OPENAI/i.test(s)) {
        authSurfaced = true;
        writer.send('text_delta', { text: `\n**❗ Codex authentication needed.**\nRun \`codex login\` in your terminal, or set OPENAI_API_KEY in Settings → Agent CLIs → Configure Codex.\n\n` });
      } else if (s.trim()) {
        writer.send('text_delta', { text: `_${s.trim().replace(/\n/g, ' ')}_\n` });
      }
    });

    const abort = () => { try { child.kill('SIGTERM'); } catch {} };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    child.on('error', (err) => {
      writer.send('error', { message: `codex spawn error: ${err.message}` });
      writer.send('done', {});
      resolve({ ok: false });
    });
    child.on('close', (code) => {
      if (!sawAnyOutput) {
        const detail = stderrBuf.trim() || 'no output and no error — is Codex authenticated? Try `codex login`.';
        writer.send('error', { message: `Codex exited with code ${code}:\n${detail.slice(0, 4000)}` });
      }
      writer.send('done', {});
      resolve({ ok: code === 0 });
    });
  });
}

// ----------------------------------------------------------------------------
// Public dispatcher

export async function runExternalCLI({ tool, ...opts }) {
  switch (tool) {
    case 'claude': return runClaudeCode(opts);
    case 'codex':  return runCodex(opts);
    default: opts.writer.send('error', { message: `Unsupported CLI: ${tool}` }); opts.writer.send('done', {}); return { ok: false };
  }
}
