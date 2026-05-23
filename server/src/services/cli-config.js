// Per-CLI configuration stored in Aramis's `settings` table. Each tool gets
// its own row keyed `cli_config:<tool>`. Saved values are injected as env
// variables when the CLI is spawned (so users don't have to touch ~/.claude/
// or ~/.codex/ to make Aramis work).
//
// If no tool-specific config is set we fall back to the Aramis `ai` config —
// so a user who already configured Anthropic for the Aramis Agent backend
// gets a one-click "use the same key" experience for Claude Code mode.

import { getSetting, setSetting, deleteSetting } from '../db.js';
import { encrypt, decrypt, redact } from './crypto.js';

// Map tool id → which env var holds its API key + which Aramis provider
// would have the matching credential.
const TOOL_META = {
  claude: { key_env: 'ANTHROPIC_API_KEY', aramis_provider: 'anthropic', default_model: 'claude-sonnet-4-5' },
  codex:  { key_env: 'OPENAI_API_KEY',    aramis_provider: 'openai',    default_model: 'gpt-5' },
  gemini: { key_env: 'GEMINI_API_KEY',    aramis_provider: 'gemini',    default_model: null },
};

const SETTING_KEY = (tool) => `cli_config:${tool}`;

export function getToolMeta(tool) {
  return TOOL_META[tool] || null;
}

function loadRaw(tool) {
  const v = getSetting(SETTING_KEY(tool));
  return v && typeof v === 'object' ? v : {};
}

/**
 * Public view of a tool's config — API key is redacted, encrypted blob is
 * stripped, and we include the resolved environment that would be injected at
 * spawn time (with fallback to the Aramis ai config noted explicitly).
 */
export function getCliConfig(tool) {
  const meta = getToolMeta(tool);
  if (!meta) return null;
  const raw = loadRaw(tool);
  const ai = getSetting('ai') || {};
  const hasKey = !!raw.api_key_enc;
  let effectiveKeySource = null;
  if (hasKey) effectiveKeySource = 'cli_config';
  else if (ai.provider === meta.aramis_provider && ai.api_key) effectiveKeySource = 'ai_config';
  return {
    tool,
    meta: { key_env: meta.key_env, aramis_provider: meta.aramis_provider, default_model: meta.default_model },
    api_key_set: hasKey,
    api_key_masked: hasKey ? redact(decrypt(raw.api_key_enc)) : '',
    model: raw.model || ai.model || meta.default_model || null,
    base_url: raw.base_url || ai.base_url || null,
    extra_args: raw.extra_args || '',
    effective_key_source: effectiveKeySource,
    inherits_from_ai_config: effectiveKeySource === 'ai_config',
  };
}

export function setCliConfig(tool, patch = {}) {
  if (!getToolMeta(tool)) throw new Error(`unknown tool: ${tool}`);
  const cur = loadRaw(tool);
  const next = { ...cur };
  if ('api_key' in patch) {
    if (patch.api_key == null || patch.api_key === '') delete next.api_key_enc;
    else if (typeof patch.api_key === 'string' && !patch.api_key.startsWith('••••')) {
      next.api_key_enc = encrypt(patch.api_key);
    }
  }
  if ('model' in patch) next.model = patch.model || undefined;
  if ('base_url' in patch) next.base_url = patch.base_url || undefined;
  if ('extra_args' in patch) next.extra_args = patch.extra_args || undefined;
  setSetting(SETTING_KEY(tool), next);
  return getCliConfig(tool);
}

export function clearCliConfig(tool) {
  deleteSetting(SETTING_KEY(tool));
}

/**
 * Build the {env, model, extraArgs} that should be applied when spawning the
 * tool. Falls back to the Aramis `ai` config when the user hasn't set a
 * tool-specific value (so existing setups keep working).
 */
export function resolveCliRuntime(tool) {
  const meta = getToolMeta(tool);
  if (!meta) return { env: {}, model: null, base_url: null, extraArgs: [] };
  const raw = loadRaw(tool);
  const ai = getSetting('ai') || {};
  const env = {};

  // API key
  let apiKey = null;
  if (raw.api_key_enc) apiKey = decrypt(raw.api_key_enc);
  else if (ai.provider === meta.aramis_provider && ai.api_key) apiKey = ai.api_key;
  if (apiKey) env[meta.key_env] = apiKey;

  // Base URL (only honored if the tool reads it from the same env name as the SDK)
  const baseUrl = raw.base_url || (ai.provider === meta.aramis_provider ? ai.base_url : null);
  if (baseUrl) {
    if (tool === 'claude')      env.ANTHROPIC_BASE_URL = baseUrl;
    else if (tool === 'codex')  env.OPENAI_BASE_URL = baseUrl;
    else if (tool === 'gemini') env.GEMINI_BASE_URL = baseUrl;
  }

  // Model — passed through as a flag the runner will use.
  const model = raw.model || (ai.provider === meta.aramis_provider ? ai.model : null) || meta.default_model;

  // Free-form extra args (string → array). Allow quoted segments.
  const extraArgsStr = (raw.extra_args || '').trim();
  const extraArgs = extraArgsStr ? splitArgs(extraArgsStr) : [];

  return { env, model, base_url: baseUrl || null, extraArgs };
}

function splitArgs(str) {
  // Minimal shell-ish split: spaces separate, single/double quotes group.
  const out = [];
  let cur = '', quote = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}
