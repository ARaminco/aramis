import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { runDiagnostics } from '../services/diagnostics.js';

export const diagnosticsRouter = Router();
diagnosticsRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

diagnosticsRouter.post('/run', wrap(async (req, res) => {
  const result = await runDiagnostics();
  res.json(result);
}));
