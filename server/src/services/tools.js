import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setMemory, deleteMemory, listMemory } from '../db.js';

// OpenAI-compatible tool schemas. Anthropic translation is done at the adapter level.
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command on the host machine. Returns stdout, stderr, and exit code. Use the appropriate shell for the detected OS (bash/sh on Linux/macOS, PowerShell or cmd on Windows). Long output is truncated; for big files use read_file instead.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The exact shell command to run.' },
          cwd: { type: 'string', description: 'Optional working directory (absolute path).' },
          timeout_seconds: { type: 'number', description: 'Optional kill timeout (default 120, max 1800).' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from disk. Returns content (up to 200KB) and file size.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or ~/-relative file path.' },
          max_bytes: { type: 'number', description: 'Cap on returned bytes (default 200000).' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a text file on disk. Use this for config files, scripts, etc.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or ~/-relative file path.' },
          content: { type: 'string', description: 'Full file contents to write.' },
          append: { type: 'boolean', description: 'If true, append instead of overwrite. Default false.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the contents of a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (absolute or ~/-relative).' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Pause and ask the user a question (e.g. a confirmation, a password, a missing parameter). The user answer is returned as a string. Use sparingly — only when you genuinely need user input to proceed.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question to display.' },
          sensitive: { type: 'boolean', description: 'If true, hide the input as a password.' },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Persist a long-term note that survives across chats. Use ONLY for information that is durably useful for FUTURE conversations: a user preference ("prefers apt over snap"), a fixed environmental fact ("prod DB host is db.acme.internal"), a non-obvious workflow rule, or a path/identifier the user will reuse. Do NOT store ephemeral session state, conversation summaries, or things that are obvious from the codebase.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'A short kebab-case identifier, e.g. "prefer-apt-over-snap", "prod-db-host".' },
          value: { type: 'string', description: 'The fact or preference, written in plain prose. Include the *why* when relevant.' },
          kind: {
            type: 'string',
            enum: ['preference', 'fact', 'env', 'secret', 'note'],
            description: 'Category — preference (user style), fact (durable info), env (host/infra), secret (credentials — store sparingly), note (other).',
          },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Delete a stored memory entry by key. Use when the user explicitly asks to forget something, or when a previously stored fact is now wrong.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The memory key to remove.' },
        },
        required: ['key'],
        additionalProperties: false,
      },
    },
  },
];

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

const MAX_OUTPUT = 64_000;

function truncate(s) {
  if (s.length <= MAX_OUTPUT) return s;
  const head = s.slice(0, MAX_OUTPUT - 200);
  return head + `\n…[truncated ${s.length - head.length} bytes]`;
}

export async function runCommand({ command, cwd, timeout_seconds }, { onChunk } = {}) {
  const timeoutMs = Math.min(Math.max((timeout_seconds || 120) * 1000, 1000), 1_800_000);
  const isWin = process.platform === 'win32';
  const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
  const args = isWin ? ['/d', '/s', '/c', command] : ['-lc', command];

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: cwd ? expandHome(cwd) : process.cwd(),
      env: process.env,
      shell: false,
    });
    let stdout = '', stderr = '';
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      const s = d.toString('utf8');
      stdout += s;
      try { onChunk?.('stdout', s); } catch {}
    });
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      stderr += s;
      try { onChunk?.('stderr', s); } catch {}
    });
    child.on('error', (err) => {
      clearTimeout(t);
      resolve({ ok: false, error: err.message, stdout, stderr, exit_code: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({
        ok: !killed && code === 0,
        exit_code: code,
        killed,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      });
    });
  });
}

export async function readFile({ path: p, max_bytes }) {
  try {
    const full = expandHome(p);
    const stat = await fs.stat(full);
    const cap = Math.min(max_bytes || 200_000, 2_000_000);
    const fh = await fs.open(full, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, cap));
    await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    return {
      ok: true,
      size: stat.size,
      truncated: stat.size > buf.length,
      content: buf.toString('utf8'),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function writeFile({ path: p, content, append }) {
  try {
    const full = expandHome(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (append) await fs.appendFile(full, content, 'utf8');
    else await fs.writeFile(full, content, 'utf8');
    const stat = await fs.stat(full);
    return { ok: true, bytes_written: Buffer.byteLength(content, 'utf8'), final_size: stat.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function listDir({ path: p }) {
  try {
    const full = expandHome(p);
    const entries = await fs.readdir(full, { withFileTypes: true });
    return {
      ok: true,
      path: full,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file',
      })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function rememberFact({ key, value, kind }) {
  try {
    setMemory(key, value, kind || 'note');
    return { ok: true, key, kind: kind || 'note' };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function forgetFact({ key }) {
  const changes = deleteMemory(key);
  return { ok: changes > 0, removed: changes };
}

export async function executeTool(name, args, opts = {}) {
  switch (name) {
    case 'run_command': return runCommand(args, opts);
    case 'read_file': return readFile(args);
    case 'write_file': return writeFile(args);
    case 'list_dir': return listDir(args);
    case 'remember': return rememberFact(args);
    case 'forget': return forgetFact(args);
    case 'ask_user': throw new Error('ask_user must be handled by the agent loop, not executeTool');
    default: return { ok: false, error: `unknown tool: ${name}` };
  }
}

export { listMemory };
