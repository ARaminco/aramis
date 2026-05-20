import { Router } from 'express';
import { detectSystem } from '../services/system-info.js';
import { getSetting, setSetting } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const systemRouter = Router();
systemRouter.use(requireAuth);

systemRouter.get('/info', (req, res) => {
  let info = getSetting('system_info');
  if (!info) {
    info = detectSystem();
    setSetting('system_info', info);
  }
  res.json({ info });
});

systemRouter.post('/redetect', (req, res) => {
  const info = detectSystem();
  setSetting('system_info', info);
  res.json({ info });
});
