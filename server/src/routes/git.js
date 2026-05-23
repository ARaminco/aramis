// Minimal git introspection. Read-only by default — the only "write" op is
// `commit` (which requires staged changes & a message). Anything more
// (branch, stash, rebase, ...) the user can do via the Aramis agent in chat.

import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requireAuth } from '../middleware/auth.js';

const execFileAsync = promisify(execFile);

export const gitRouter = Router();
gitRouter.use(requireAuth);

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

async function isGitRepo(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 3000 });
    return stdout.trim() === 'true';
  } catch { return false; }
}

gitRouter.get('/status', async (req, res, next) => {
  try {
    const cwd = expandHome(String(req.query.path || process.cwd()));
    try { await fs.access(cwd); } catch { return res.status(400).json({ error: 'path not found' }); }
    if (!(await isGitRepo(cwd))) {
      return res.json({ ok: true, is_repo: false, cwd });
    }
    const [branchRes, statusRes, logRes] = await Promise.allSettled([
      execFileAsync('git', ['branch', '--show-current'], { cwd, timeout: 3000 }),
      execFileAsync('git', ['status', '--porcelain=v1', '-b'], { cwd, timeout: 5000 }),
      execFileAsync('git', ['log', '--oneline', '-n', '12', '--decorate'], { cwd, timeout: 5000 }),
    ]);
    const branch = branchRes.status === 'fulfilled' ? branchRes.value.stdout.trim() : null;
    const statusText = statusRes.status === 'fulfilled' ? statusRes.value.stdout : '';
    const log = logRes.status === 'fulfilled'
      ? logRes.value.stdout.split('\n').filter(Boolean).map((l) => l.replace(/\s+$/, ''))
      : [];

    const lines = statusText.split('\n').filter(Boolean);
    const head = lines[0]?.startsWith('##') ? lines.shift() : '';
    const files = lines.map((line) => {
      const code = line.slice(0, 2);
      const name = line.slice(3);
      return {
        path: name,
        index: code[0],
        worktree: code[1],
        staged: code[0] !== ' ' && code[0] !== '?',
        untracked: code === '??',
      };
    });

    res.json({
      ok: true,
      is_repo: true,
      cwd,
      branch,
      head_line: head,
      files,
      log,
    });
  } catch (e) { next(e); }
});

gitRouter.post('/stage', async (req, res, next) => {
  try {
    const cwd = expandHome(String(req.body?.path || process.cwd()));
    const files = Array.isArray(req.body?.files) ? req.body.files : null;
    const args = ['add', '--', ...(files && files.length ? files : ['.'])];
    await execFileAsync('git', args, { cwd, timeout: 15000 });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

gitRouter.post('/unstage', async (req, res, next) => {
  try {
    const cwd = expandHome(String(req.body?.path || process.cwd()));
    const files = Array.isArray(req.body?.files) ? req.body.files : null;
    const args = ['reset', 'HEAD', '--', ...(files && files.length ? files : ['.'])];
    await execFileAsync('git', args, { cwd, timeout: 15000 });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

gitRouter.post('/commit', async (req, res, next) => {
  try {
    const cwd = expandHome(String(req.body?.path || process.cwd()));
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'commit message required' });
    const { stdout, stderr } = await execFileAsync('git', ['commit', '-m', message], { cwd, timeout: 20000 });
    res.json({ ok: true, output: stdout + stderr });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

gitRouter.get('/diff', async (req, res, next) => {
  try {
    const cwd = expandHome(String(req.query.path || process.cwd()));
    const file = req.query.file ? String(req.query.file) : null;
    const staged = req.query.staged === '1';
    const args = ['diff', '--no-color'];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
    res.json({ ok: true, diff: stdout });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
