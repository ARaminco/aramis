// Integrated terminal — PTY backend wired to a WebSocket.
//
// One WebSocket per terminal tab. Wire protocol (text frames; we never use
// the binary opcode so message-type detection is trivial):
//
//   Client → Server
//     "{ \"type\": \"input\",  \"data\": \"…\" }"   stdin (utf8)
//     "{ \"type\": \"resize\", \"cols\": N, \"rows\": M }"
//     "{ \"type\": \"signal\", \"name\": \"SIGINT\" }"   // currently SIGINT / SIGTERM
//
//   Server → Client
//     "{ \"type\": \"data\",   \"data\": \"…\" }"   pty output (utf8)
//     "{ \"type\": \"ready\",  \"pid\": N, \"shell\": \"…\", \"cwd\": \"…\" }"
//     "{ \"type\": \"exit\",   \"code\": N, \"signal\": S|null }"
//     "{ \"type\": \"error\",  \"message\": \"…\" }"
//
// Auth: the WebSocket upgrade carries `?token=<jwt>`; verifyToken() must
// return a payload, otherwise the upgrade is refused with HTTP 401.
//
// Lifecycle:
//   - Inactivity timeout (30 min default) — pty is killed and ws closed.
//   - Per-connection idle keep-alive ping every 30 s; ws.terminate() on miss.
//   - All ptys are tracked so server shutdown can reap them cleanly.

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

// node-pty is a native module. If the prebuild can't load (rare on exotic
// platforms), we politely refuse to open a session instead of crashing.
let pty;
try {
  const mod = await import('node-pty');
  pty = mod.default || mod;
} catch (err) {
  console.warn('[aramis] node-pty failed to load:', err.message);
  pty = null;
}

let WebSocketServer;
try {
  WebSocketServer = (await import('ws')).WebSocketServer;
} catch (err) {
  console.warn('[aramis] ws missing; terminal disabled:', err.message);
  WebSocketServer = null;
}

import { verifyToken } from '../middleware/auth.js';

const MAX_SESSIONS = 16;
const IDLE_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 30_000;
const MAX_FRAME_BYTES = 64 * 1024;

const sessions = new Map(); // ws → { pty, lastUse, alive }

function defaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function safeCwd(reqCwd) {
  if (!reqCwd) return os.homedir();
  try {
    const resolved = path.resolve(String(reqCwd));
    // Sync existsSync would be nice but we're already in async context.
    return resolved;
  } catch {
    return os.homedir();
  }
}

function jsonSend(ws, obj) {
  if (ws.readyState !== 1 /* OPEN */) return;
  try { ws.send(JSON.stringify(obj)); }
  catch { /* socket may have closed mid-send */ }
}

function reapAll(reason) {
  for (const [ws, sess] of sessions) {
    try { sess.pty.kill('SIGHUP'); } catch {}
    try { ws.close(1001, reason || 'server-shutdown'); } catch {}
  }
  sessions.clear();
}

/**
 * Attach the terminal WebSocket endpoint to an http.Server.
 * Call this once from index.js *after* startServer resolves.
 */
export function attachTerminal(httpServer) {
  if (!pty || !WebSocketServer) {
    httpServer.on('upgrade', (req, socket) => {
      if (!req.url?.startsWith('/api/terminal')) return;
      const reason = !pty ? 'node-pty unavailable' : 'ws unavailable';
      socket.write(`HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n${reason}\r\n`);
      socket.destroy();
    });
    return { reap: () => {}, available: false };
  }

  // noServer + manual handleUpgrade lets us authenticate before the
  // connection is upgraded, returning a proper HTTP error on failure.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url) return;
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/terminal') return;

    const token = url.searchParams.get('token');
    const user = token ? verifyToken(token) : null;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (sessions.size >= MAX_SESSIONS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\ntoo many terminals\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const cols = clampInt(url.searchParams.get('cols'), 80, 1, 500);
      const rows = clampInt(url.searchParams.get('rows'), 24, 1, 200);
      const requestedCwd = url.searchParams.get('cwd');
      const cwd = safeCwd(requestedCwd);
      startSession(ws, cols, rows, cwd);
    });
  });

  return {
    reap: (reason) => reapAll(reason),
    count: () => sessions.size,
    available: true,
  };
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function startSession(ws, cols, rows, cwd) {
  // Validate cwd exists; fall back to home dir if it doesn't.
  let useCwd = cwd;
  try {
    const st = await fs.stat(cwd);
    if (!st.isDirectory()) useCwd = os.homedir();
  } catch { useCwd = os.homedir(); }

  const shell = defaultShell();
  const args = process.platform === 'win32' ? [] : ['-l']; // login shell on *nix

  let term;
  try {
    term = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols, rows,
      cwd: useCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        // Hint downstream tooling so prompts can detect us if they care.
        ARAMIS_TERMINAL: '1',
        LANG: process.env.LANG || 'en_US.UTF-8',
      },
    });
  } catch (e) {
    jsonSend(ws, { type: 'error', message: `failed to spawn ${shell}: ${e.message}` });
    try { ws.close(1011, 'spawn-failed'); } catch {}
    return;
  }

  const sess = { pty: term, lastUse: Date.now(), alive: true };
  sessions.set(ws, sess);

  jsonSend(ws, { type: 'ready', pid: term.pid, shell, cwd: useCwd, cols, rows });

  term.onData((data) => {
    sess.lastUse = Date.now();
    jsonSend(ws, { type: 'data', data });
  });

  term.onExit(({ exitCode, signal }) => {
    jsonSend(ws, { type: 'exit', code: exitCode ?? null, signal: signal ?? null });
    try { ws.close(1000, 'pty-exited'); } catch {}
    sessions.delete(ws);
  });

  ws.on('message', (raw) => {
    sess.lastUse = Date.now();
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); }
    catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'input':
        if (typeof msg.data === 'string') {
          // Safety cap so a runaway producer can't fill PTY buffers.
          if (Buffer.byteLength(msg.data) <= MAX_FRAME_BYTES) {
            try { term.write(msg.data); } catch {}
          }
        }
        break;
      case 'resize': {
        const c = clampInt(msg.cols, 80, 1, 500);
        const r = clampInt(msg.rows, 24, 1, 200);
        try { term.resize(c, r); } catch {}
        break;
      }
      case 'signal': {
        const allowed = new Set(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGHUP']);
        if (allowed.has(msg.name)) {
          try { term.kill(msg.name); } catch {}
        }
        break;
      }
      default:
        // ignore unknown frame types — forward-compat
        break;
    }
  });

  ws.on('pong', () => { sess.alive = true; });
  ws.on('close', () => {
    try { term.kill('SIGHUP'); } catch {}
    sessions.delete(ws);
  });
  ws.on('error', (err) => {
    console.warn('[aramis] terminal ws error:', err.message);
    try { term.kill('SIGHUP'); } catch {}
    sessions.delete(ws);
  });
}

// Connection liveness + idle cleanup, one timer for all sessions.
setInterval(() => {
  const now = Date.now();
  for (const [ws, sess] of sessions) {
    if (!sess.alive) {
      try { sess.pty.kill('SIGHUP'); } catch {}
      try { ws.terminate(); } catch {}
      sessions.delete(ws);
      continue;
    }
    if (now - sess.lastUse > IDLE_MS) {
      jsonSend(ws, { type: 'error', message: 'idle-timeout' });
      try { sess.pty.kill('SIGHUP'); } catch {}
      try { ws.close(1000, 'idle'); } catch {}
      sessions.delete(ws);
      continue;
    }
    sess.alive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS).unref();

// Best-effort cleanup on parent shutdown.
process.on('exit', () => reapAll('process-exit'));
process.on('SIGINT', () => { reapAll('sigint'); process.exit(0); });
process.on('SIGTERM', () => { reapAll('sigterm'); process.exit(0); });
