import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_SCHEMAS } from './tools.js';

/*
  Unified AI provider layer.

  Three families:
   - openai: OpenAI proper (api.openai.com).
   - openai_compatible: any OpenAI-compatible endpoint (Ollama, Groq, OpenRouter,
     Together, vLLM, LM Studio, …). Uses the OpenAI SDK with a custom baseURL.
   - anthropic: Claude family via @anthropic-ai/sdk. Tools are converted.

  Returns an async-iterable of unified events:
    { type: 'text_delta', text }
    { type: 'tool_call', id, name, args }   // args is a parsed object
    { type: 'message_done', message }       // a final assistant message in OpenAI shape
                                            //   ({ role: 'assistant', content, tool_calls? })
*/

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
};

function configuredTimeoutMs(config) {
  const s = Number(config?.request_timeout_seconds);
  if (Number.isFinite(s) && s > 0) return Math.min(600, Math.max(10, s)) * 1000;
  return 120_000; // sensible default for chat with tools over slow links
}

function buildOpenAIClient(config, { timeout, maxRetries = 0 } = {}) {
  if (timeout == null) timeout = configuredTimeoutMs(config);
  const provider = config.provider || 'openai';
  let baseURL = config.base_url;
  if (!baseURL) {
    if (provider === 'openai') baseURL = DEFAULT_BASE_URLS.openai;
    else if (provider === 'ollama') baseURL = DEFAULT_BASE_URLS.ollama;
    else if (provider === 'groq') baseURL = DEFAULT_BASE_URLS.groq;
    else if (provider === 'openrouter') baseURL = DEFAULT_BASE_URLS.openrouter;
    else if (provider === 'together') baseURL = DEFAULT_BASE_URLS.together;
    else baseURL = DEFAULT_BASE_URLS.openai;
  }
  // Ollama doesn't strictly require a key but OpenAI SDK does — pass a dummy.
  const apiKey = config.api_key || (provider === 'ollama' ? 'ollama' : '');
  if (!apiKey) throw new Error(`API key is required for provider "${provider}"`);
  return new OpenAI({ apiKey, baseURL, timeout, maxRetries });
}

/**
 * Minimal non-streaming probe used by the diagnostics endpoint.
 * Returns the model's reply text on success, throws a rewritten error on failure.
 */
export async function pingProvider({ config, timeoutMs = 20_000 } = {}) {
  const provider = config?.provider || 'openai';
  const model = config?.model;
  if (!config || !model) throw new Error('AI is not configured (missing provider or model).');
  if (provider !== 'ollama' && !config.api_key) {
    throw new Error('API key is missing in the AI configuration.');
  }

  const probeMessages = [{ role: 'user', content: 'Reply with the single word: PONG' }];

  if (provider === 'anthropic') {
    const client = new Anthropic({
      apiKey: config.api_key,
      baseURL: config.base_url || undefined,
      timeout: timeoutMs,
      maxRetries: 0,
    });
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 16,
        messages: probeMessages,
      });
      const text = (r.content || []).map((b) => b.text || '').join('').trim();
      return text;
    } catch (err) {
      throw rewriteProviderError(err, { provider, model, baseURL: client.baseURL, timeoutMs });
    }
  }

  const client = buildOpenAIClient(config, { timeout: timeoutMs, maxRetries: 0 });
  try {
    const r = await client.chat.completions.create({
      model,
      messages: probeMessages,
      max_tokens: 16,
      temperature: 0,
    });
    return (r.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    throw rewriteProviderError(err, { provider, model, baseURL: client.baseURL, timeoutMs });
  }
}

export async function* streamCompletion({ config, messages, signal }) {
  const provider = config.provider || 'openai';
  const model = config.model;
  if (!model) throw new Error('AI model is not configured');

  if (provider === 'anthropic') {
    yield* anthropicStream({ config, model, messages, signal });
    return;
  }
  yield* openaiStream({ config, model, messages, signal });
}

function rewriteProviderError(err, { provider, model, baseURL, timeoutMs, elapsedMs }) {
  const status = err?.status || err?.response?.status;
  const msg = err?.message || String(err);
  const name = err?.name || '';
  const code = err?.code || '';
  const causeCode = err?.cause?.code || '';
  const causeMsg = err?.cause?.message || '';
  const where = baseURL || provider;
  const elapsed = elapsedMs ?? 0;

  // Log the raw upstream error so the operator can debug from server logs.
  console.error('[AI provider error]', {
    provider, model, baseURL,
    elapsedMs: elapsed,
    name, code, status, causeCode,
    message: msg,
    causeMessage: causeMsg,
  });

  // 1) HTTP status codes — most precise, prefer these first.
  if (status === 401) return new Error('Invalid API key. Please re-enter the key in Settings.');
  if (status === 403) return new Error(`Provider denied access (HTTP 403). OpenAI restricts some regions/IPs — try OpenRouter, Groq, or local Ollama. Raw: ${msg}`);
  if (status === 404) return new Error(`Model "${model}" was not found at ${where}. Check the model name in Settings.`);
  if (status === 429) return new Error(`Rate limit or quota exceeded at ${provider}. Wait a moment or check your billing.`);
  if (status && status >= 500) return new Error(`Upstream provider returned HTTP ${status}: ${msg}. Try again later or switch provider.`);

  // 2) Specific network error codes — these are reliable signals.
  const connCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
  const matchedCode = connCodes.find((c) => c === code || c === causeCode) ||
    (/econnrefused|enotfound|ehostunreach|cert_has_expired/i.exec(msg + ' ' + causeMsg) || [])[0]?.toUpperCase();
  if (matchedCode) {
    return new Error(`Cannot reach ${where} (${matchedCode}). The host is blocked, DNS failed, or the certificate is invalid. Check VPN/proxy, or switch provider in Settings.`);
  }

  // 3) If the failure happened almost instantly, it's NOT a real timeout regardless of error name.
  if (elapsed > 0 && elapsed < 5_000) {
    return new Error(`The provider rejected the request in ${elapsed}ms before producing a response: "${msg}"${causeMsg ? ` (cause: ${causeMsg})` : ''}. This is usually a blocked endpoint, an invalid TLS handshake, or a malformed body — not a timeout. Check the Base URL and try a different provider (Groq, OpenRouter, Ollama).`);
  }

  // 4) Real timeout — only label as timeout if we actually waited a substantial time.
  const isTimeout = name === 'APIConnectionTimeoutError' || code === 'ETIMEDOUT' || /timed? *out/i.test(msg);
  const isAbort = name === 'APIUserAbortError' || /aborted/i.test(msg);
  if (isTimeout || isAbort) {
    const t = Math.round((timeoutMs || 120_000) / 1000);
    const actually = elapsed ? ` (failed after ${Math.round(elapsed / 1000)}s)` : '';
    return new Error(`The model at ${where} did not respond within ${t}s${actually}. Try increasing "Request timeout" in Settings, or switch to a faster provider (Groq, OpenRouter, local Ollama).`);
  }

  // 5) Generic connection error (catch-all for SDK's APIConnectionError when codes aren't exposed).
  if (name === 'APIConnectionError' || /connection error|fetch failed|network error|socket hang up/i.test(msg)) {
    return new Error(`Cannot reach ${where}: ${msg}${causeMsg ? ` (cause: ${causeMsg})` : ''}. Check internet/VPN/proxy, or change the provider/Base URL.`);
  }

  // Fallback — keep the raw message so the operator at least sees something honest.
  return new Error(`AI provider error (${name || 'unknown'}): ${msg}${causeMsg ? ` — cause: ${causeMsg}` : ''}`);
}

async function* openaiStream({ config, model, messages, signal }) {
  const client = buildOpenAIClient(config);
  const startedAt = Date.now();

  let stream;
  try {
    stream = await client.chat.completions.create({
      model,
      messages,
      tools: TOOL_SCHEMAS,
      tool_choice: 'auto',
      stream: true,
      temperature: config.temperature ?? 0.2,
    }, { signal });
  } catch (err) {
    throw rewriteProviderError(err, {
      provider: config.provider, model, baseURL: client.baseURL,
      timeoutMs: configuredTimeoutMs(config),
      elapsedMs: Date.now() - startedAt,
    });
  }

  const accumulated = {
    role: 'assistant',
    content: '',
    tool_calls: /** @type {any[]} */ ([]),
  };

  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        accumulated.content += delta.content;
        yield { type: 'text_delta', text: delta.content };
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!accumulated.tool_calls[idx]) {
            accumulated.tool_calls[idx] = {
              id: tc.id || `call_${idx}`,
              type: 'function',
              function: { name: tc.function?.name || '', arguments: '' },
            };
          }
          const acc = accumulated.tool_calls[idx];
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.function.name = tc.function.name;
          if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
        }
      }
    }
  } catch (err) {
    throw rewriteProviderError(err, {
      provider: config.provider, model, baseURL: client.baseURL,
      timeoutMs: configuredTimeoutMs(config),
      elapsedMs: Date.now() - startedAt,
    });
  }

  if (accumulated.tool_calls.length === 0) {
    delete accumulated.tool_calls;
  } else {
    for (const tc of accumulated.tool_calls) {
      let parsed = {};
      try { parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; }
      catch { parsed = { __raw: tc.function.arguments }; }
      yield { type: 'tool_call', id: tc.id, name: tc.function.name, args: parsed };
    }
  }
  yield { type: 'message_done', message: accumulated };
}

// ---------- Anthropic adapter ----------

function toAnthropicTools() {
  return TOOL_SCHEMAS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function toAnthropicMessages(messages) {
  // Extract leading system messages, concatenate, then convert remaining.
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + (m.content || '');
      continue;
    }
    if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          let input = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
      }
      out.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      // Append as a user message containing a tool_result block. Merge with the previous
      // user-role entry when possible to keep alternation valid.
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content || '' });
    }
  }
  return { system, messages: out };
}

async function* anthropicStream({ config, model, messages, signal }) {
  if (!config.api_key) throw new Error('Anthropic API key is required');
  const client = new Anthropic({
    apiKey: config.api_key,
    baseURL: config.base_url || undefined,
    timeout: configuredTimeoutMs(config),
    maxRetries: 0,
  });
  const startedAt = Date.now();
  const { system, messages: am } = toAnthropicMessages(messages);

  let stream;
  try {
    stream = client.messages.stream({
      model,
      max_tokens: config.max_tokens || 4096,
      system: system || undefined,
      messages: am,
      tools: toAnthropicTools(),
      temperature: config.temperature ?? 0.2,
    }, { signal });
  } catch (err) {
    throw rewriteProviderError(err, {
      provider: 'anthropic', model, baseURL: client.baseURL,
      timeoutMs: configuredTimeoutMs(config),
      elapsedMs: Date.now() - startedAt,
    });
  }

  const accumulated = { role: 'assistant', content: '', tool_calls: [] };
  const partial = new Map(); // block index -> { id, name, jsonStr }

  for await (const ev of stream) {
    if (ev.type === 'content_block_start') {
      if (ev.content_block?.type === 'tool_use') {
        partial.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, jsonStr: '' });
      }
    } else if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta') {
        accumulated.content += ev.delta.text;
        yield { type: 'text_delta', text: ev.delta.text };
      } else if (ev.delta?.type === 'input_json_delta') {
        const p = partial.get(ev.index);
        if (p) p.jsonStr += ev.delta.partial_json || '';
      }
    } else if (ev.type === 'content_block_stop') {
      const p = partial.get(ev.index);
      if (p) {
        let args = {};
        try { args = p.jsonStr ? JSON.parse(p.jsonStr) : {}; } catch { args = { __raw: p.jsonStr }; }
        accumulated.tool_calls.push({
          id: p.id,
          type: 'function',
          function: { name: p.name, arguments: JSON.stringify(args) },
        });
        yield { type: 'tool_call', id: p.id, name: p.name, args };
        partial.delete(ev.index);
      }
    }
  }

  if (accumulated.tool_calls.length === 0) delete accumulated.tool_calls;
  yield { type: 'message_done', message: accumulated };
}
