import { Router } from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import { requireAuth } from '../middleware/auth.js';
import { getSetting } from '../db.js';

export const transcribeRouter = Router();
transcribeRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // OpenAI/Groq Whisper hard cap
});

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  ollama: 'http://localhost:11434/v1',
};

// Whisper-style model defaults per provider
function defaultModel(provider) {
  if (provider === 'groq') return 'whisper-large-v3-turbo';
  return 'whisper-1';
}

function pickBaseURL(cfg) {
  if (cfg.base_url) return cfg.base_url;
  return DEFAULT_BASE_URLS[cfg.provider] || DEFAULT_BASE_URLS.openai;
}

// Providers that have no chat-compatible /audio/transcriptions endpoint.
const UNSUPPORTED_PROVIDERS = new Set(['anthropic', 'ollama']);

transcribeRouter.post('/', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio file is required (form field "audio")' });

    const aiConfig = getSetting('ai');
    if (!aiConfig || !aiConfig.api_key) {
      return res.status(400).json({ error: 'A provider with an API key is required for voice transcription. Configure OpenAI or Groq in Settings.' });
    }
    if (UNSUPPORTED_PROVIDERS.has(aiConfig.provider)) {
      return res.status(400).json({ error: `Voice transcription is not supported by provider "${aiConfig.provider}". Switch to OpenAI, Groq, or an OpenAI-compatible endpoint with Whisper.` });
    }

    const baseURL = pickBaseURL(aiConfig);
    const model = aiConfig.transcription_model || defaultModel(aiConfig.provider);

    const client = new OpenAI({
      apiKey: aiConfig.api_key,
      baseURL,
      timeout: 60_000,
      maxRetries: 0,
    });

    // Pick a sensible filename / mimetype so the upstream sees a recognised audio format.
    const incomingType = req.file.mimetype || 'audio/webm';
    const extByType = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg' };
    const ext = extByType[incomingType] || (req.file.originalname?.split('.').pop()) || 'webm';

    const file = await toFile(req.file.buffer, `voice.${ext}`, { type: incomingType });

    const started = Date.now();
    const response = await client.audio.transcriptions.create({
      file,
      model,
      // language omitted → Whisper auto-detects across 99+ languages
    });

    res.json({
      text: response.text || '',
      model,
      provider: aiConfig.provider,
      duration_ms: Date.now() - started,
    });
  } catch (err) {
    console.error('[transcribe error]', {
      name: err?.name, code: err?.code, status: err?.status,
      message: err?.message, causeCode: err?.cause?.code,
    });
    const status = err?.status;
    let msg = err?.message || 'transcription failed';
    if (status === 401) msg = 'Invalid API key for transcription.';
    else if (status === 404) msg = 'The transcription model is not available on this provider. Try Groq (whisper-large-v3-turbo) or OpenAI (whisper-1).';
    else if (status === 413) msg = 'Recording is too large. Keep it under 25 MB.';
    res.status(status || 500).json({ error: msg });
  }
});
