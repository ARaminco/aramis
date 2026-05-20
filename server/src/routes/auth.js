import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getSetting, setSetting } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// Express 4 does not auto-forward async route errors. Wrap async handlers so
// rejected promises reach the global error handler instead of hanging the request.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

authRouter.get('/status', (req, res) => {
  const hash = getSetting('admin_password_hash');
  res.json({ initialized: !!hash });
});

authRouter.post('/setup', wrap(async (req, res) => {
  const existing = getSetting('admin_password_hash');
  if (existing) return res.status(409).json({ error: 'already initialized' });
  const { password } = req.body || {};
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  const hash = await bcrypt.hash(password, 12);
  setSetting('admin_password_hash', hash);
  const token = signToken({ sub: 'admin' });
  res.json({ ok: true, token });
}));

authRouter.post('/login', wrap(async (req, res) => {
  const { password } = req.body || {};
  const hash = getSetting('admin_password_hash');
  if (!hash) return res.status(400).json({ error: 'not initialized' });
  if (!password) return res.status(400).json({ error: 'password required' });
  const ok = await bcrypt.compare(password, hash);
  if (!ok) return res.status(401).json({ error: 'invalid password' });
  const token = signToken({ sub: 'admin' });
  res.json({ ok: true, token });
}));

authRouter.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const hash = getSetting('admin_password_hash');
  if (!hash || !(await bcrypt.compare(current || '', hash))) {
    return res.status(401).json({ error: 'current password is incorrect' });
  }
  if (!next || next.length < 6) return res.status(400).json({ error: 'new password too short' });
  setSetting('admin_password_hash', await bcrypt.hash(next, 12));
  res.json({ ok: true });
}));
