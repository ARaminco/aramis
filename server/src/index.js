import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import './db.js'; // initializes schema
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional .env loading — skip silently if dotenv isn't installed or fails (e.g. inside Electron).
try {
  const dotenv = await import('dotenv').catch(() => null);
  if (dotenv?.config) dotenv.config();
} catch { /* ignore */ }

/**
 * Build the Express app. Exposing this lets the Electron wrapper start the
 * same server in-process on a random local port.
 */
export function createApp({ staticDir } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));
  app.use('/api/auth', authRouter);
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

  // Serve built frontend if present (default location for monorepo run).
  const distDir = staticDir || path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((err, req, res, _next) => {
    console.error(`[server error] ${req.method} ${req.originalUrl} →`, err);
    if (res.headersSent) return;
    res.status(500).json({ error: err.message || 'internal error' });
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
