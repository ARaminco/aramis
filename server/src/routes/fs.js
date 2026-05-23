// File-system browser endpoints. These run with the server's permissions —
// access is gated by `requireAuth`, but otherwise we assume the operator is
// trusted (same trust model as the run_command tool). To keep accidental
// recursion / huge listings cheap, list responses are capped.

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requireAuth } from '../middleware/auth.js';

export const fsRouter = Router();
fsRouter.use(requireAuth);

const MAX_ENTRIES = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

fsRouter.get('/home', (_req, res) => {
  res.json({ home: os.homedir(), cwd: process.cwd(), sep: path.sep });
});

fsRouter.get('/list', async (req, res, next) => {
  try {
    const target = expandHome(String(req.query.path || os.homedir()));
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'not a directory' });
    const raw = await fs.readdir(target, { withFileTypes: true });
    const entries = raw.slice(0, MAX_ENTRIES).map((d) => {
      let kind;
      if (d.isDirectory()) kind = 'dir';
      else if (d.isSymbolicLink()) kind = 'symlink';
      else kind = 'file';
      return {
        name: d.name,
        type: kind,
        path: path.join(target, d.name),
        hidden: d.name.startsWith('.'),
      };
    });
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({
      path: target,
      parent: path.dirname(target),
      truncated: raw.length > MAX_ENTRIES,
      entries,
    });
  } catch (e) { next(e); }
});

fsRouter.get('/read', async (req, res, next) => {
  try {
    const target = expandHome(String(req.query.path || ''));
    if (!target) return res.status(400).json({ error: 'path required' });
    const stat = await fs.stat(target);
    if (!stat.isFile()) return res.status(400).json({ error: 'not a file' });
    if (stat.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `file too large (${stat.size} bytes; limit ${MAX_FILE_BYTES})` });
    }
    const buf = await fs.readFile(target);
    // crude binary detection
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    let isBinary = false;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) { isBinary = true; break; }
    }
    res.json({
      path: target,
      size: stat.size,
      mtime: stat.mtimeMs,
      binary: isBinary,
      content: isBinary ? '' : buf.toString('utf8'),
    });
  } catch (e) { next(e); }
});

fsRouter.post('/write', async (req, res, next) => {
  try {
    const { path: p, content } = req.body || {};
    if (!p || typeof content !== 'string') return res.status(400).json({ error: 'path and content required' });
    const target = expandHome(String(p));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    const stat = await fs.stat(target);
    res.json({ ok: true, path: target, size: stat.size, mtime: stat.mtimeMs });
  } catch (e) { next(e); }
});
