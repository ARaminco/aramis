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
  createChat: (opts = {}) => {
    const body = typeof opts === 'string' ? { title: opts } : opts;
    return request('/chats', { method: 'POST', body: JSON.stringify(body) });
  },
  getChat: (id) => request(`/chats/${id}`),
  renameChat: (id, title) => request(`/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  updateChat: (id, patch) => request(`/chats/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteChat: (id) => request(`/chats/${id}`, { method: 'DELETE' }),

  // External CLIs (Claude Code / Codex / ...)
  detectCLIs: () => request('/cli/detect'),
  listCLISessions: (tool, cwd) => request(`/cli/sessions/${encodeURIComponent(tool)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  cliInstallers: () => request('/cli/installers'),
  cliInstallOptions: (tool) => request(`/cli/install-options/${encodeURIComponent(tool)}`),
  cliGetConfig: (tool) => request(`/cli/config/${encodeURIComponent(tool)}`),
  cliSetConfig: (tool, patch) => request(`/cli/config/${encodeURIComponent(tool)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  cliClearConfig: (tool) => request(`/cli/config/${encodeURIComponent(tool)}`, { method: 'DELETE' }),
  cliBootstrap: () => request('/cli/bootstrap'),
  cliOpenTerminal: (command) => request('/cli/open-terminal', { method: 'POST', body: JSON.stringify({ command }) }),
  cliRefreshPath: () => request('/cli/refresh-path', { method: 'POST' }),

  // Image uploads (chat composer paste / picker)
  uploadImage: async (file) => {
    const fd = new FormData();
    fd.append('image', file, file.name || 'image');
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/uploads/image`, { method: 'POST', headers, body: fd });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  // Streaming install/uninstall — returns an abort function.
  cliInstallStream(tool, manager, onEvent) {
    return cliStreamPlan('install', tool, manager, onEvent);
  },
  cliUninstallStream(tool, manager, onEvent) {
    return cliStreamPlan('uninstall', tool, manager, onEvent);
  },

  // Filesystem
  fsHome: () => request('/fs/home'),
  fsList: (path) => request(`/fs/list?path=${encodeURIComponent(path)}`),
  fsRead: (path) => request(`/fs/read?path=${encodeURIComponent(path)}`),
  fsWrite: (path, content) => request('/fs/write', { method: 'POST', body: JSON.stringify({ path, content }) }),

  // Changelog
  getChangelog: () => request('/changelog'),

  // SSH
  sshHosts: () => request('/ssh/hosts'),
  sshProbe: (host, port) => request('/ssh/probe', { method: 'POST', body: JSON.stringify({ host, port }) }),
  sshExec: (host, command, timeout_seconds) => request('/ssh/exec', { method: 'POST', body: JSON.stringify({ host, command, timeout_seconds }) }),
  // Streaming ssh — returns a function that aborts.
  sshStream(host, command, onEvent) {
    const ctrl = new AbortController();
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${BASE}/ssh/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ host, command }),
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
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message', dataStr = '';
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

  // FTP
  ftpList: () => request('/ftp/connections'),
  ftpCreate: (conn) => request('/ftp/connections', { method: 'POST', body: JSON.stringify(conn) }),
  ftpUpdate: (id, patch) => request(`/ftp/connections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  ftpDelete: (id) => request(`/ftp/connections/${id}`, { method: 'DELETE' }),
  ftpTest: (id) => request(`/ftp/connections/${id}/test`, { method: 'POST' }),
  ftpListDir: (id, path) => request(`/ftp/connections/${id}/list`, { method: 'POST', body: JSON.stringify({ path }) }),
  ftpRead: (id, path) => request(`/ftp/connections/${id}/read`, { method: 'POST', body: JSON.stringify({ path }) }),
  ftpWrite: (id, path, content) => request(`/ftp/connections/${id}/write`, { method: 'POST', body: JSON.stringify({ path, content }) }),
  ftpRemove: (id, path) => request(`/ftp/connections/${id}/delete`, { method: 'POST', body: JSON.stringify({ path }) }),
  ftpMkdir: (id, path) => request(`/ftp/connections/${id}/mkdir`, { method: 'POST', body: JSON.stringify({ path }) }),

  // Git
  gitStatus: (path) => request(`/git/status?path=${encodeURIComponent(path)}`),
  gitStage: (path, files) => request('/git/stage', { method: 'POST', body: JSON.stringify({ path, files }) }),
  gitUnstage: (path, files) => request('/git/unstage', { method: 'POST', body: JSON.stringify({ path, files }) }),
  gitCommit: (path, message) => request('/git/commit', { method: 'POST', body: JSON.stringify({ path, message }) }),
  gitDiff: (path, file, staged) => request(`/git/diff?path=${encodeURIComponent(path)}${file ? `&file=${encodeURIComponent(file)}` : ''}${staged ? '&staged=1' : ''}`),

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

// Shared SSE helper for /api/cli/install + /api/cli/uninstall.
function cliStreamPlan(kind, tool, manager, onEvent) {
  const ctrl = new AbortController();
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  fetch(`${BASE}/cli/${kind}/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ manager }),
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
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message', dataStr = '';
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
}
