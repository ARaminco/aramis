import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-prod';

export function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, SECRET, { expiresIn });
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.query.token || null);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}
