import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { detectCLIs, listClaudeSessions, listCodexSessions } from '../services/cli-runner.js';

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
