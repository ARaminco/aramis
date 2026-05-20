const BASE = '/api';

function getToken() {
  return localStorage.getItem('aramis_token') || '';
}

export function setToken(t) {
  if (t) localStorage.setItem('aramis_token', t);
  else localStorage.removeItem('aramis_token');
}

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  if (res.status === 401) {
    setToken('');
    if (location.hash !== '#/login') location.hash = '#/login';
  }
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  authStatus: () => request('/auth/status'),
  setup: (password) => request('/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  login: (password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  changePassword: (current, next) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ current, next }) }),

  getAIConfig: () => request('/config/ai'),
  setAIConfig: (cfg) => request('/config/ai', { method: 'PUT', body: JSON.stringify(cfg) }),

  getSystemInfo: () => request('/system/info'),
  redetectSystem: () => request('/system/redetect', { method: 'POST' }),

  // Diagnostics
  runDiagnostics: () => request('/diagnostics/run', { method: 'POST' }),

  // Data / memory
  getDataStats: () => request('/data/stats'),
  exportDbUrl: () => `${BASE}/data/export?token=${encodeURIComponent(getToken())}`,
  wipeData: () => request('/data/wipe', { method: 'POST' }),
  listMemory: () => request('/data/memory'),
  upsertMemory: (entry) => request('/data/memory', { method: 'PUT', body: JSON.stringify(entry) }),
  deleteMemory: (key) => request(`/data/memory/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  clearMemory: () => request('/data/memory', { method: 'DELETE' }),

  listChats: () => request('/chats'),
  createChat: (title) => request('/chats', { method: 'POST', body: JSON.stringify({ title }) }),
  getChat: (id) => request(`/chats/${id}`),
  renameChat: (id, title) => request(`/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteChat: (id) => request(`/chats/${id}`, { method: 'DELETE' }),

  /**
   * Stream a chat turn. Supply either { content } or { ask_response }.
   * onEvent receives { event, data } parsed from the SSE stream.
   * Returns a function that aborts the stream.
   */
  streamChat(id, body, onEvent) {
    const ctrl = new AbortController();
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${BASE}/chats/${id}/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        onEvent({ event: 'error', data: { message: t || res.statusText } });
        onEvent({ event: 'done', data: {} });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // Parse complete SSE frames separated by a blank line
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let dataStr = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          let data; try { data = JSON.parse(dataStr); } catch { data = { raw: dataStr }; }
          onEvent({ event, data });
        }
      }
    }).catch((err) => {
      if (ctrl.signal.aborted) return;
      onEvent({ event: 'error', data: { message: err.message || String(err) } });
      onEvent({ event: 'done', data: {} });
    });
    return () => ctrl.abort();
  },
};
