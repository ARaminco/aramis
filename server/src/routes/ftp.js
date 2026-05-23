import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, redact } from '../services/crypto.js';
import { ftpTest, ftpList, ftpReadFile, ftpWriteFile, ftpDelete, ftpMkdir } from '../services/ftp.js';

export const ftpRouter = Router();
ftpRouter.use(requireAuth);

const PROTOCOLS = new Set(['ftp', 'ftps']);

function loadConnection(id) {
  return db.prepare(`
    SELECT id, label, protocol, host, port, username, password_enc, initial_path, secure, created_at, updated_at
    FROM ftp_connections WHERE id = ?
  `).get(id);
}

function publicConn(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    username: row.username,
    has_password: !!row.password_enc,
    password_masked: row.password_enc ? redact('xx') : '',
    initial_path: row.initial_path,
    secure: !!row.secure,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---- CRUD ---------------------------------------------------------------

ftpRouter.get('/connections', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, label, protocol, host, port, username, password_enc, initial_path, secure, created_at, updated_at
    FROM ftp_connections ORDER BY updated_at DESC
  `).all();
  res.json({ connections: rows.map(publicConn) });
});

ftpRouter.post('/connections', (req, res) => {
  const { label, protocol = 'ftp', host, port = 21, username = 'anonymous', password, initial_path, secure = false } = req.body || {};
  if (!label || !host) return res.status(400).json({ error: 'label and host required' });
  if (!PROTOCOLS.has(protocol)) return res.status(400).json({ error: `protocol must be one of ${[...PROTOCOLS].join(', ')}` });
  const id = nanoid();
  const now = Date.now();
  db.prepare(`
    INSERT INTO ftp_connections (id, label, protocol, host, port, username, password_enc, initial_path, secure, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(label).slice(0, 80),
    protocol,
    String(host).slice(0, 255),
    Number(port) || 21,
    String(username).slice(0, 80),
    password ? encrypt(password) : null,
    initial_path ? String(initial_path).slice(0, 500) : null,
    (protocol === 'ftps' || secure) ? 1 : 0,
    now, now,
  );
  res.json({ connection: publicConn(loadConnection(id)) });
});

ftpRouter.patch('/connections/:id', (req, res) => {
  const { id } = req.params;
  const row = loadConnection(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const sets = [], args = [];
  const f = req.body || {};
  if (typeof f.label === 'string')    { sets.push('label = ?');         args.push(f.label.slice(0, 80)); }
  if (typeof f.protocol === 'string' && PROTOCOLS.has(f.protocol)) { sets.push('protocol = ?'); args.push(f.protocol); }
  if (typeof f.host === 'string')     { sets.push('host = ?');          args.push(f.host.slice(0, 255)); }
  if (f.port != null)                  { sets.push('port = ?');         args.push(Number(f.port) || 21); }
  if (typeof f.username === 'string') { sets.push('username = ?');      args.push(f.username.slice(0, 80)); }
  if ('password' in f) {
    if (f.password === '' || f.password == null) { sets.push('password_enc = ?'); args.push(null); }
    else if (typeof f.password === 'string')     { sets.push('password_enc = ?'); args.push(encrypt(f.password)); }
  }
  if ('initial_path' in f) { sets.push('initial_path = ?'); args.push(f.initial_path ? String(f.initial_path).slice(0, 500) : null); }
  if ('secure' in f)       { sets.push('secure = ?');       args.push(f.secure ? 1 : 0); }
  if (sets.length === 0)   return res.status(400).json({ error: 'no fields to update' });
  sets.push('updated_at = ?'); args.push(Date.now());
  args.push(id);
  db.prepare(`UPDATE ftp_connections SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json({ connection: publicConn(loadConnection(id)) });
});

ftpRouter.delete('/connections/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM ftp_connections WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- Operations ----------------------------------------------------------

function withConnection(req, res, fn) {
  const { id } = req.params;
  const conn = loadConnection(id);
  if (!conn) { res.status(404).json({ error: 'not found' }); return; }
  fn(conn);
}

ftpRouter.post('/connections/:id/test', (req, res, next) => {
  withConnection(req, res, async (conn) => {
    try { res.json(await ftpTest(conn)); } catch (e) { next(e); }
  });
});

ftpRouter.post('/connections/:id/list', (req, res, next) => {
  withConnection(req, res, async (conn) => {
    try { res.json(await ftpList(conn, req.body?.path || conn.initial_path || '')); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
});

ftpRouter.post('/connections/:id/read', (req, res, next) => {
  withConnection(req, res, async (conn) => {
    if (!req.body?.path) return res.status(400).json({ error: 'path required' });
    try { res.json(await ftpReadFile(conn, req.body.path)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
});

ftpRouter.post('/connections/:id/write', (req, res, next) => {
  withConnection(req, res, async (conn) => {
    const { path, content } = req.body || {};
    if (!path || typeof content !== 'string') return res.status(400).json({ error: 'path and content required' });
    try { res.json(await ftpWriteFile(conn, path, content)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
});

ftpRouter.post('/connections/:id/delete', (req, res, next) => {
  withConnection(req, res, async (conn) => {
    if (!req.body?.path) return res.status(400).json({ error: 'path required' });
    try { res.json(await ftpDelete(conn, req.body.path)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
});

ftpRouter.post('/connections/:id/mkdir', (req, res, next) => {
  withConnection(req, res, async (conn) => {
    if (!req.body?.path) return res.status(400).json({ error: 'path required' });
    try { res.json(await ftpMkdir(conn, req.body.path)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
});
