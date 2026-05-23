// Discover the user's existing SSH hosts so they can be surfaced in the UI
// without re-entering credentials. Two sources:
//
//   1. ~/.ssh/config       — host aliases (the primary, canonical source)
//   2. ~/.ssh/known_hosts  — every host the user has connected to via ssh
//
// We never read private keys; auth is handed off to the system's `ssh` binary
// (which uses ssh-agent / ~/.ssh/id_* automatically).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { findBin } from './path-discover.js';

const SSH_DIR = path.join(os.homedir(), '.ssh');

// ---------- ~/.ssh/config parser ----------------------------------------
//
// Standard openssh config grammar (simplified): blocks start with `Host <pattern>`
// followed by indented `Key Value` pairs. Values can be quoted. We tolerate
// extra whitespace and `=`-style assignment.

function parseSshConfig(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;
  let included = []; // unused — we don't follow Include for simplicity

  for (let raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    // Tokenize: first token = keyword, rest = value (joined)
    const m = /^(\S+)\s*=?\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'host') {
      // A Host directive can list multiple patterns separated by spaces.
      const patterns = value.split(/\s+/);
      // Skip wildcard-only blocks (e.g. `Host *`).
      const aliases = patterns.filter((p) => !/[*?!]/.test(p));
      if (aliases.length) {
        for (const alias of aliases) {
          current = { alias, options: {}, source: 'config' };
          blocks.push(current);
        }
      } else {
        current = null;
      }
      continue;
    }
    if (key === 'include') {
      included.push(value);
      continue;
    }
    if (!current) continue;
    current.options[key] = value;
  }
  return blocks;
}

export async function listSshConfigHosts() {
  const file = path.join(SSH_DIR, 'config');
  try {
    const text = await fs.readFile(file, 'utf8');
    const blocks = parseSshConfig(text);
    // Deduplicate by alias (later block wins for the same alias)
    const byAlias = new Map();
    for (const b of blocks) {
      const opts = b.options || {};
      byAlias.set(b.alias, {
        alias: b.alias,
        hostname: opts.hostname || b.alias,
        user: opts.user || null,
        port: opts.port ? Number(opts.port) : 22,
        identity_file: opts.identityfile || null,
        proxy_jump: opts.proxyjump || null,
        forward_agent: opts.forwardagent === 'yes',
        source: 'config',
      });
    }
    return Array.from(byAlias.values());
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// ---------- ~/.ssh/known_hosts parser -----------------------------------
//
// Each line: `<host>[,<host>...] <key-type> <key>`. The host field may be
// hashed (`|1|...`); we surface those as opaque "(hashed entry)" rather than
// pretending we can resolve them.

export async function listSshKnownHosts() {
  const file = path.join(SSH_DIR, 'known_hosts');
  try {
    const text = await fs.readFile(file, 'utf8');
    const out = new Map();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      const [hostField] = line.split(/\s+/);
      if (!hostField) continue;
      if (hostField.startsWith('|')) continue; // hashed — opaque to us
      for (const entry of hostField.split(',')) {
        // Strip port-tagged "[host]:port"
        let hostname = entry, port = 22;
        const portMatch = /^\[([^\]]+)\]:(\d+)$/.exec(entry);
        if (portMatch) { hostname = portMatch[1]; port = Number(portMatch[2]); }
        const key = `${hostname}:${port}`;
        if (out.has(key)) continue;
        out.set(key, { alias: hostname, hostname, port, source: 'known_hosts' });
      }
    }
    return Array.from(out.values());
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function listAllSshHosts() {
  const [cfg, known] = await Promise.all([listSshConfigHosts(), listSshKnownHosts()]);
  // Prefer config entries; supplement with known_hosts entries that aren't already named.
  const aliases = new Set(cfg.map((c) => c.alias));
  const aliasesByHost = new Set(cfg.map((c) => `${c.hostname}:${c.port}`));
  const extras = known.filter((k) => !aliases.has(k.alias) && !aliasesByHost.has(`${k.hostname}:${k.port}`));
  return [...cfg, ...extras];
}

// ---------- Lightweight TCP reachability check --------------------------
//
// Useful to give the user instant feedback ("is this host even reachable?")
// without spawning ssh. We do NOT use this for the actual exec path.

export function probeTcp(host, port = 22, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const done = (ok, err) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, error: err || null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (e) => done(false, e.code || e.message));
    try { socket.connect(port, host); }
    catch (e) { done(false, e.message); }
  });
}

// ---------- ssh exec ----------------------------------------------------
//
// We delegate to the system `ssh` so the user's existing keys, agent, and
// known_hosts policies all apply. Output is streamed via onChunk; the
// resolved value carries final stdout/stderr/exit_code.

export function sshExec({ host, command, timeoutMs = 60_000, onChunk, signal }) {
  // BatchMode disables interactive prompts (password / yes-no fingerprint).
  // If the user's host requires a password, this will fail fast with a clear
  // error rather than hanging.
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    host, '--', command,
  ];

  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let killed = false;
    let child;
    try {
      child = spawn(findBin('ssh') || 'ssh', args, { env: process.env });
    } catch (e) {
      resolve({ ok: false, error: e.message, exit_code: -1 });
      return;
    }
    const t = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    const abort = () => { killed = true; try { child.kill('SIGTERM'); } catch {} };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
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
      resolve({ ok: false, error: err.message, exit_code: -1, stdout, stderr });
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

const MAX_OUT = 64_000;
function truncate(s) {
  if (!s || s.length <= MAX_OUT) return s;
  return s.slice(0, MAX_OUT - 200) + `\n…[truncated ${s.length - (MAX_OUT - 200)} bytes]`;
}
