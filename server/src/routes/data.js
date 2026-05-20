import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth } from '../middleware/auth.js';
import {
  getDbStats, listMemory, getMemory, setMemory, deleteMemory, clearMemory,
  wipeUserData, DB_FILE_PATH,
} from '../db.js';

export const dataRouter = Router();
dataRouter.use(requireAuth);

dataRouter.get('/stats', (req, res) => {
  res.json({ stats: getDbStats() });
});

// Export the raw SQLite file (for backup).
dataRouter.get('/export', (req, res) => {
  if (!fs.existsSync(DB_FILE_PATH)) return res.status(404).json({ error: 'db file missing' });
  res.download(DB_FILE_PATH, `aramis-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
});

// Wipe chats + messages + memory (keeps password & AI config).
dataRouter.post('/wipe', (req, res) => {
  wipeUserData();
  res.json({ ok: true });
});

// Memory CRUD
dataRouter.get('/memory', (req, res) => {
  res.json({ entries: listMemory() });
});

dataRouter.put('/memory', (req, res) => {
  const { key, value, kind } = req.body || {};
  if (!key || value == null) return res.status(400).json({ error: 'key and value required' });
  try {
    setMemory(key, value, kind || 'note');
    res.json({ ok: true, entry: getMemory(key) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

dataRouter.delete('/memory/:key', (req, res) => {
  const changes = deleteMemory(req.params.key);
  res.json({ ok: true, removed: changes });
});

dataRouter.delete('/memory', (req, res) => {
  const changes = clearMemory();
  res.json({ ok: true, removed: changes });
});
