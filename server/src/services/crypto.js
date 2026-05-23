// Symmetric AES-256-GCM helper for at-rest password / token storage. The key
// is derived from JWT_SECRET via scrypt so we don't introduce a second secret
// to manage. If JWT_SECRET ever changes, previously-encrypted values become
// undecryptable — which is the same blast-radius as the JWT_SECRET rotation
// already implies for sessions.

import crypto from 'node:crypto';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-prod';
let KEY = null;
function key() {
  if (!KEY) KEY = crypto.scryptSync(SECRET, 'aramis-storage-salt-v1', 32);
  return KEY;
}

export function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'enc1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blob) {
  if (!blob) return '';
  if (typeof blob !== 'string' || !blob.startsWith('enc1:')) return blob; // legacy / plain
  try {
    const buf = Buffer.from(blob.slice(5), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// Redact a secret for display: keep the last 2 chars, mask the rest.
export function redact(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 2) return '••';
  return '••••' + s.slice(-2);
}
