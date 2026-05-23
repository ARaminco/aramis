import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { detectCLIs, listClaudeSessions, listCodexSessions } from '../services/cli-runner.js';
import { detectInstallers, getInstallOptions, runPlan } from '../services/cli-installer.js';
import { getCliConfig, setCliConfig, clearCliConfig } from '../services/cli-config.js';
import { suggestBootstrap, openInTerminal } from '../services/bootstrap.js';
import { discoverPath, clearPathCache, applyDiscoveredPath } from '../services/path-discover.js';

export const cliRouter = Router();
cliRouter.use(requireAuth);

cliRouter.get('/detect', (_req, res) => {
  res.json({ tools: detectCLIs() });
});

cliRouter.get('/sessions/:tool', async (req, res, next) => {
  try {
    const { tool } = req.params;
    const cwd = req.query.cwd ? String(req.query.cwd) : undefined;
    if (tool === 'claude') return res.json({ sessions: await listClaudeSessions({ cwd }) });
    if (tool === 'codex')  return res.json({ sessions: await listCodexSessions() });
    res.status(400).json({ error: `unknown tool: ${tool}` });
  } catch (e) { next(e); }
});

// ---- Install / Uninstall ------------------------------------------------

cliRouter.get('/installers', (_req, res) => {
  res.json({ installers: detectInstallers() });
});

cliRouter.get('/install-options/:tool', (req, res) => {
  const opts = getInstallOptions(req.params.tool);
  if (!opts) return res.status(404).json({ error: 'unknown tool' });
  res.json(opts);
});

function streamPlan(req, res, kind) {
  const { tool } = req.params;
  const manager = String(req.body?.manager || req.query.manager || '');
  if (!manager) {
    res.status(400).json({ error: 'manager required' });
    return;
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  send('start', { tool, manager, kind });
  runPlan({
    tool, manager, kind,
    onEvent: (name, data) => send(name, data),
    signal: controller.signal,
  })
    .then(() => send('done', {}))
    .catch((e) => { send('error', { message: e.message || String(e) }); send('done', {}); })
    .finally(() => { try { res.end(); } catch {} });
}

cliRouter.post('/install/:tool', (req, res) => streamPlan(req, res, 'install'));
cliRouter.post('/uninstall/:tool', (req, res) => streamPlan(req, res, 'uninstall'));

// ---- Per-CLI configuration ---------------------------------------------

cliRouter.get('/config/:tool', (req, res) => {
  const cfg = getCliConfig(req.params.tool);
  if (!cfg) return res.status(404).json({ error: 'unknown tool' });
  res.json({ config: cfg });
});

cliRouter.put('/config/:tool', (req, res) => {
  try {
    const cfg = setCliConfig(req.params.tool, req.body || {});
    res.json({ config: cfg });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

cliRouter.delete('/config/:tool', (req, res) => {
  clearCliConfig(req.params.tool);
  res.json({ ok: true });
});

// ---- OS-aware bootstrap helpers ----------------------------------------

// Suggest a recommended install command per platform when nothing is on PATH.
cliRouter.get('/bootstrap', async (_req, res, next) => {
  try {
    const data = await suggestBootstrap();
    res.json(data);
  } catch (e) { next(e); }
});

// Open the user's system terminal with a command pre-typed.
cliRouter.post('/open-terminal', async (req, res, next) => {
  try {
    const cmd = String(req.body?.command || '').trim();
    if (!cmd) return res.status(400).json({ error: 'command required' });
    res.json(await openInTerminal(cmd));
  } catch (e) { next(e); }
});

// Re-scan PATH (e.g. after the user opened a terminal and installed something).
cliRouter.post('/refresh-path', (_req, res) => {
  clearPathCache();
  applyDiscoveredPath();
  res.json({ ok: true, path: process.env.PATH });
});
