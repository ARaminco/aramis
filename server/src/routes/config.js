import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const configRouter = Router();
configRouter.use(requireAuth);

function redact(cfg) {
  if (!cfg) return null;
  const c = { ...cfg };
  if (c.api_key) c.api_key = `••••${String(c.api_key).slice(-4)}`;
  return c;
}

configRouter.get('/ai', (req, res) => {
  res.json({ config: redact(getSetting('ai')) });
});

const PROVIDERS = ['openai', 'openai_compatible', 'ollama', 'groq', 'openrouter', 'together', 'anthropic'];

configRouter.put('/ai', (req, res) => {
  const { provider, api_key, model, base_url, temperature, max_tokens, request_timeout_seconds, command_approval } = req.body || {};
  if (!provider || !PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of ${PROVIDERS.join(', ')}` });
  }
  if (!model) return res.status(400).json({ error: 'model required' });

  const existing = getSetting('ai') || {};
  // Allow keeping the existing key when the user re-saves without entering it.
  const key = api_key && !api_key.startsWith('••••') ? api_key : existing.api_key;
  if (!key && provider !== 'ollama') return res.status(400).json({ error: 'api_key required' });

  const cfg = {
    provider,
    api_key: key || '',
    model,
    base_url: base_url || '',
    temperature: typeof temperature === 'number' ? temperature : (existing.temperature ?? 0.2),
    max_tokens: typeof max_tokens === 'number' ? max_tokens : (existing.max_tokens ?? 4096),
    request_timeout_seconds: clampTimeout(request_timeout_seconds, existing.request_timeout_seconds),
    command_approval: command_approval === 'manual' ? 'manual' : (command_approval === 'auto' ? 'auto' : (existing.command_approval || 'auto')),
  };
  setSetting('ai', cfg);
  res.json({ ok: true, config: redact(cfg) });
});

function clampTimeout(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return Number.isFinite(fallback) ? fallback : 120;
  return Math.min(600, Math.max(10, Math.round(n)));
}
