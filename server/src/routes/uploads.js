// Image uploads for the chat composer — accepts a pasted/dropped image,
// validates it, stores it in the SQLite-adjacent uploads dir, and returns
// a stable URL that the client can embed in the user message.

import { Router } from 'express';
import multer from 'multer';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function uploadsDir() {
  // Default sits next to the SQLite DB (server/data/uploads) so the user's
  // backup of `server/data/` captures their chat images too. Honors DB_PATH
  // when set so Electron's userData dir is used in packaged builds.
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR;
  if (process.env.DB_PATH) return path.join(path.dirname(process.env.DB_PATH), 'uploads');
  return path.resolve(__dirname, '..', '..', 'data', 'uploads');
}

// Allowlist images only — we don't accept arbitrary uploads (no exfiltration
// channel, no risk of someone uploading a binary and convincing the user to
// execute it). Cap at 10 MiB per file.
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MAX_BYTES = 10 * 1024 * 1024;

function extFor(mime) {
  switch (mime) {
    case 'image/png':  return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif':  return 'gif';
    case 'image/avif': return 'avif';
    default:           return 'bin';
  }
}

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post('/image', memUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(415).json({ error: `unsupported image type: ${req.file.mimetype}` });
    }
    const id = crypto.randomBytes(16).toString('hex');
    const ext = extFor(req.file.mimetype);
    const dir = uploadsDir();
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${id}.${ext}`);
    await fs.writeFile(dest, req.file.buffer);
    res.json({
      ok: true,
      id,
      url: `/uploads/${id}.${ext}`,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  } catch (e) { next(e); }
});

/**
 * Authenticated-by-opaque-id static handler. The file names are 32-char
 * hex IDs the server generated — they are unguessable by an attacker, so
 * we don't add a token check (any user logged into Aramis is by definition
 * the operator). External access requires HTTPS + non-trivial guesswork.
 */
export function uploadsStatic() {
  const router = Router();
  const dir = uploadsDir();
  // Only serve files whose name matches our opaque ID pattern.
  router.use((req, res, next) => {
    if (!/^\/[a-f0-9]{32}\.(png|jpg|jpeg|webp|gif|avif)$/i.test(req.path)) {
      return res.status(404).end();
    }
    next();
  });
  router.use(express.static(dir, {
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
    setHeaders(res) { res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); },
  }));
  return router;
}
