// Thin wrapper around `basic-ftp` for one-off remote operations. The library
// keeps per-call connections (we open, do the thing, close) — this is slower
// than a long-lived client but simpler and a better fit for our request/response
// HTTP model. For high-frequency operations we can add connection pooling
// later.

import { Client } from 'basic-ftp';
import { Writable, Readable } from 'node:stream';
import { decrypt } from './crypto.js';

const TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MiB cap for in-memory read/write

function isAnonymous(conn) {
  return !conn.username || conn.username === 'anonymous';
}

async function withClient(conn, fn) {
  const client = new Client(TIMEOUT_MS);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: conn.host,
      port: Number(conn.port || 21),
      user: conn.username || 'anonymous',
      password: isAnonymous(conn) ? 'anonymous@aramis.local' : decrypt(conn.password_enc),
      secure: !!conn.secure,
      secureOptions: { rejectUnauthorized: false },
    });
    return await fn(client);
  } finally {
    try { client.close(); } catch {}
  }
}

export async function ftpTest(conn) {
  try {
    const features = await withClient(conn, async (c) => {
      // pwd() is the cheapest "I'm in" probe.
      const pwd = await c.pwd();
      return { pwd };
    });
    return { ok: true, ...features };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

export async function ftpList(conn, remotePath) {
  return withClient(conn, async (c) => {
    if (remotePath) await c.cd(remotePath);
    const list = await c.list();
    return {
      ok: true,
      path: await c.pwd(),
      entries: list.map((e) => ({
        name: e.name,
        type: e.type === 1 ? 'file' : (e.type === 2 ? 'dir' : 'symlink'),
        size: e.size,
        modified: e.rawModifiedAt || (e.modifiedAt ? e.modifiedAt.toISOString?.() || String(e.modifiedAt) : null),
        permissions: e.permissions ? `${e.permissions.user || ''}/${e.permissions.group || ''}/${e.permissions.world || ''}` : null,
      })),
    };
  });
}

export async function ftpReadFile(conn, remotePath) {
  return withClient(conn, async (c) => {
    const chunks = [];
    let total = 0;
    let truncated = false;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        total += chunk.length;
        if (truncated) return cb();
        if (total > MAX_FILE_BYTES) {
          truncated = true;
          // Keep the prefix that fits the cap.
          const remaining = MAX_FILE_BYTES - (total - chunk.length);
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          return cb();
        }
        chunks.push(chunk);
        cb();
      },
    });
    await c.downloadTo(sink, remotePath);
    const buf = Buffer.concat(chunks);
    // Crude binary check.
    let isBinary = false;
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    for (let i = 0; i < sample.length; i++) { if (sample[i] === 0) { isBinary = true; break; } }
    return {
      ok: true,
      size: total,
      truncated,
      binary: isBinary,
      content: isBinary ? '' : buf.toString('utf8'),
    };
  });
}

export async function ftpWriteFile(conn, remotePath, content) {
  return withClient(conn, async (c) => {
    const buf = Buffer.from(content, 'utf8');
    const src = Readable.from(buf);
    await c.uploadFrom(src, remotePath);
    return { ok: true, path: remotePath, bytes_written: buf.length };
  });
}

export async function ftpDelete(conn, remotePath) {
  return withClient(conn, async (c) => {
    await c.remove(remotePath);
    return { ok: true, path: remotePath };
  });
}

export async function ftpMkdir(conn, remotePath) {
  return withClient(conn, async (c) => {
    await c.ensureDir(remotePath);
    return { ok: true, path: remotePath };
  });
}
