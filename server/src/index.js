import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import './db.js'; // initializes schema
import { applyDiscoveredPath } from './services/path-discover.js';
applyDiscoveredPath();
import { authRouter } from './routes/auth.js';
import { configRouter } from './routes/config.js';
import { systemRouter } from './routes/system.js';
import { chatRouter } from './routes/chat.js';
import { dataRouter } from './routes/data.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { transcribeRouter } from './routes/transcribe.js';
import { cliRouter } from './routes/cli.js';
import { fsRouter } from './routes/fs.js';
import { gitRouter } from './routes/git.js';
import { changelogRouter } from './routes/changelog.js';
import { updateRouter } from './routes/update.js';
import { sshRouter } from './routes/ssh.js';
import { ftpRouter } from './routes/ftp.js';
import { uploadsRouter, uploadsStatic } from './routes/uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional .env loading — skip silently if dotenv isn't installed or fails (e.g. inside Electron).
try {
  const dotenv = await import('dotenv').catch(() => null);
  if (dotenv?.config) dotenv.config();
} catch { /* ignore */ }

// Refuse to start in production with the dev JWT_SECRET. This catches the
// classic "forgot to set the secret" deployment foot-gun before someone
// inherits a server with a known signing key.
const DEV_SECRET = 'dev-only-secret-change-in-prod';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_SECRET)) {
  console.error('\n[aramis] FATAL: NODE_ENV=production but JWT_SECRET is unset or still the dev default.\n' +
                'Generate a strong secret (e.g. `openssl rand -hex 48`) and set JWT_SECRET before starting.\n');
  process.exit(1);
}

/**
 * Build the Express app. Exposing this lets the Electron wrapper start the
 * same server in-process on a random local port.
 */
export function createApp({ staticDir } = {}) {
  const app = express();

  // Trust the first reverse-proxy hop so X-Forwarded-For is respected for the
  // rate limiter (no-op when there's no proxy).
  app.set('trust proxy', 1);

  // -- Security middleware --------------------------------------------------
  //
  // Helmet sets sensible defaults (X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, Referrer-Policy, etc.). We disable its CSP
  // here because the Electron wrapper sets its own (different) CSP via meta
  // tag, and in browser deploys the Vite-built bundle is the single CSP
  // authority. We do NOT disable contentSecurityPolicy lightly — we just
  // hand it off to the page.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false, // allow loading images from data: URLs
  }));

  // CORS: in production lock to a known origin. In dev/Electron the default
  // `*` is fine because the server is bound to 127.0.0.1 and never reachable
  // from the public internet.
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()) }));

  app.use(express.json({ limit: '10mb' }));

  // Rate-limit the unauthenticated endpoints (setup / login). The defaults are
  // tuned for "one human at a keyboard" — bots get throttled quickly.
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many auth attempts — slow down' },
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/config', configRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/chats', chatRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/diagnostics', diagnosticsRouter);
  app.use('/api/transcribe', transcribeRouter);
  app.use('/api/cli', cliRouter);
  app.use('/api/fs', fsRouter);
  app.use('/api/git', gitRouter);
  app.use('/api/changelog', changelogRouter);
  app.use('/api/update', updateRouter);
  app.use('/api/ssh', sshRouter);
  app.use('/api/ftp', ftpRouter);
  app.use('/api/uploads', uploadsRouter);
  // Public, authenticated-by-opaque-id static serving of uploaded images.
  app.use('/uploads', uploadsStatic());

  // Serve built frontend if present (default location for monorepo run).
  const distDir = staticDir || path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((err, req, res, _next) => {
    // Anything with a 4xx statusCode is a user-error we want to surface
    // verbatim; everything else is a programmer error and gets a generic 500
    // (the full stack lands in server logs but never on the wire).
    const status = Number(err.statusCode) >= 400 && Number(err.statusCode) < 500 ? Number(err.statusCode) : 500;
    if (status >= 500) console.error(`[server error] ${req.method} ${req.originalUrl} →`, err);
    if (res.headersSent) return;
    res.status(status).json({ error: err.message || 'internal error' });
  });

  return app;
}

/**
 * Start the server. If `port` is 0, the OS assigns a free port.
 * Returns { port, server, close() }.
 */
export function startServer({ port, staticDir } = {}) {
  const desiredPort = port != null ? port : Number(process.env.PORT || 5174);
  const app = createApp({ staticDir });
  return new Promise((resolve) => {
    const server = app.listen(desiredPort, () => {
      const actual = server.address().port;
      console.log(`[aramis] server listening on http://localhost:${actual}`);
      resolve({
        port: actual,
        server,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Auto-start when this file is run directly (npm start / node src/index.js).
// `import.meta.url` resolves to the file URL; `process.argv[1]` to the entry path.
const isDirectRun = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here);
  } catch { return false; }
})();
if (isDirectRun) {
  startServer();
}
