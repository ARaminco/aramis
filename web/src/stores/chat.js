import { defineStore } from 'pinia';
import { api } from '@/lib/api';

const MODE_KEY = 'aramis_default_mode';
const CWD_KEY = 'aramis_default_cwd';

function getDefaultMode() {
  const m = localStorage.getItem(MODE_KEY);
  return (m === 'claude' || m === 'codex') ? m : 'aramis';
}
function getDefaultCwd() {
  return localStorage.getItem(CWD_KEY) || '';
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    chats: [],
    activeId: null,
    activeMode: 'aramis',
    activeCwd: '',
    activeExternalSessionId: null,
    messages: [],
    streaming: false,
    phase: null,
    pendingAsk: null,
    abortStream: null,
    cliMeta: null,           // { session_id, model, cwd, total_cost_usd, duration_ms, ... }
    // composer-level mode (persisted across sessions). Applied on new chat & on send.
    composerMode: getDefaultMode(),
    composerCwd: getDefaultCwd(),
    // tools the user has detected on this host (from /api/cli/detect)
    detectedCLIs: null,
  }),
  getters: {
    pinnedChats(state) { return state.chats.filter((c) => c.pinned); },
    unpinnedChats(state) { return state.chats.filter((c) => !c.pinned); },
  },
  actions: {
    setComposerMode(mode) {
      this.composerMode = mode;
      localStorage.setItem(MODE_KEY, mode);
    },
    setComposerCwd(cwd) {
      this.composerCwd = cwd;
      localStorage.setItem(CWD_KEY, cwd);
    },

    async detectCLIs() {
      try { const r = await api.detectCLIs(); this.detectedCLIs = r.tools; }
      catch { this.detectedCLIs = []; }
    },

    async loadChats() {
      const { chats } = await api.listChats();
      this.chats = chats;
    },
    async createChat(opts = {}) {
      const mode = opts.mode || this.composerMode || 'aramis';
      const cwd = opts.cwd ?? this.composerCwd ?? '';
      const chat = await api.createChat({
        title: opts.title || '',
        mode,
        cwd: cwd || null,
        external_session_id: opts.external_session_id || null,
      });
      this.chats.unshift(chat);
      await this.openChat(chat.id);
      return chat.id;
    },
    async openChat(id) {
      const { chat, messages, pending_ask } = await api.getChat(id);
      this.activeId = chat.id;
      this.activeMode = chat.mode || 'aramis';
      this.activeCwd = chat.cwd || '';
      this.activeExternalSessionId = chat.external_session_id || null;
      this.messages = rebuildTimeline(messages);
      this.pendingAsk = pending_ask || null;
      this.phase = null;
      this.cliMeta = null;
    },
    async renameChat(id, title) {
      await api.renameChat(id, title);
      const c = this.chats.find((x) => x.id === id); if (c) c.title = title;
    },
    async togglePin(id) {
      const c = this.chats.find((x) => x.id === id); if (!c) return;
      const next = c.pinned ? 0 : 1;
      await api.updateChat(id, { pinned: !!next });
      c.pinned = next;
      // Re-sort
      this.chats.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
    },
    async setChatMode(id, mode) {
      await api.updateChat(id, { mode });
      const c = this.chats.find((x) => x.id === id); if (c) c.mode = mode;
      if (this.activeId === id) this.activeMode = mode;
    },
    async setChatCwd(id, cwd) {
      await api.updateChat(id, { cwd });
      const c = this.chats.find((x) => x.id === id); if (c) c.cwd = cwd;
      if (this.activeId === id) this.activeCwd = cwd;
    },
    async deleteChat(id) {
      await api.deleteChat(id);
      this.chats = this.chats.filter((c) => c.id !== id);
      if (this.activeId === id) this.clearActiveChat();
    },

    /**
     * Reset the view to an empty "new chat" state WITHOUT creating a DB row.
     * The chat is created lazily when the user sends their first message —
     * this keeps the sidebar from filling up with empty placeholder chats.
     */
    clearActiveChat() {
      this.activeId = null;
      this.messages = [];
      this.pendingAsk = null;
      this.phase = null;
      this.cliMeta = null;
      this.activeExternalSessionId = null;
      this.activeMode = this.composerMode || 'aramis';
      this.activeCwd = this.composerCwd || '';
    },

    pushUser(content) {
      this.messages.push({ role: 'user', content, created_at: Date.now() });
    },

    async sendMessage(content) {
      if (!this.activeId) {
        // First message in a freshly cleared "new chat" — create the row now
        // and pre-fill the title from this message so the sidebar entry never
        // shows a placeholder.
        const titleHint = content.slice(0, 60).replace(/\s+/g, ' ').trim();
        await this.createChat({ title: titleHint });
      }
      this.pushUser(content);
      await this._stream({ content, mode: this.activeMode || this.composerMode });
    },

    async respondToAsk(answer) {
      if (!this.pendingAsk) return;
      this.messages.push({
        role: 'ask_answer',
        content: this.pendingAsk.sensitive ? '••••••••' : answer,
        question: this.pendingAsk.question,
        created_at: Date.now(),
      });
      this.pendingAsk = null;
      await this._stream({ ask_response: answer });
    },

    async approveToolCall(toolCallId, approved) {
      for (const m of this.messages) {
        if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
          const tc = m.tool_calls.find((t) => t.id === toolCallId);
          if (tc && tc.status === 'pending_approval') {
            tc.status = approved ? 'running' : 'done';
            if (!approved) tc.result = { ok: false, error: 'User declined', declined: true };
            break;
          }
        }
      }
      await this._stream({ approval: { tool_call_id: toolCallId, approved } });
    },

    stopStream() {
      if (this.abortStream) this.abortStream();
      this.streaming = false;
      this.phase = null;
    },

    _newAssistantBubble() {
      const bubble = {
        role: 'assistant',
        content: '',
        tool_calls: [],
        created_at: Date.now(),
        _streaming: true,
      };
      this.messages.push(bubble);
      return bubble;
    },

    async _stream(body) {
      if (this.streaming) return;
      this.streaming = true;
      this.phase = { phase: 'connecting' };

      let assistant = this._newAssistantBubble();

      await new Promise((resolve) => {
        this.abortStream = api.streamChat(this.activeId, body, ({ event, data }) => {
          switch (event) {
            case 'assistant_start': {
              const hasContent = assistant.content || (assistant.tool_calls && assistant.tool_calls.length);
              if (hasContent) {
                assistant._streaming = false;
                assistant = this._newAssistantBubble();
              }
              break;
            }
            case 'phase':
              this.phase = data;
              break;
            case 'text_delta':
              assistant.content += data.text;
              break;
            case 'tool_call': {
              // Update existing card (when adapter re-emits with resolved args) OR push new.
              // We capture client-side timing here so ToolCallCard can render
              // a duration without server changes.
              const existing = assistant.tool_calls.find((t) => t.id === data.id);
              if (existing) {
                existing.name = data.name || existing.name;
                existing.args = data.args || existing.args;
              } else {
                assistant.tool_calls.push({
                  id: data.id, name: data.name, args: data.args,
                  status: 'pending', stdout: '', stderr: '',
                  started_at: Date.now(),
                  completed_at: null,
                });
              }
              break;
            }
            case 'tool_running': {
              const tc = assistant.tool_calls.find((t) => t.id === data.id);
              if (tc) {
                tc.status = 'running';
                if (!tc.running_at) tc.running_at = Date.now();
              }
              break;
            }
            case 'tool_output': {
              const tc = assistant.tool_calls.find((t) => t.id === data.id);
              if (tc) {
                if (data.stream === 'stderr') tc.stderr += data.text;
                else tc.stdout += data.text;
              }
              break;
            }
            case 'tool_result': {
              const tc = assistant.tool_calls.find((t) => t.id === data.id);
              if (tc) {
                tc.status = 'done';
                tc.result = data.result;
                tc.completed_at = Date.now();
              }
              break;
            }
            case 'ask_user':
              this.pendingAsk = { tool_call_id: data.id, question: data.question, sensitive: !!data.sensitive };
              this.phase = null;
              break;
            case 'tool_approval': {
              let tc = assistant.tool_calls.find((t) => t.id === data.id);
              if (!tc) {
                tc = { id: data.id, name: data.name, args: data.args, status: 'pending_approval', stdout: '', stderr: '' };
                assistant.tool_calls.push(tc);
              } else {
                tc.status = 'pending_approval';
              }
              this.phase = null;
              break;
            }
            case 'cli_meta':
              this.cliMeta = { ...(this.cliMeta || {}), ...data };
              if (data.session_id) this.activeExternalSessionId = data.session_id;
              break;
            case 'title_update': {
              const c = this.chats.find((x) => x.id === this.activeId);
              if (c) c.title = data.title;
              break;
            }
            case 'error':
              assistant.error = data.message;
              break;
            case 'done':
              assistant._streaming = false;
              this.streaming = false;
              this.phase = null;
              this.abortStream = null;
              resolve();
              break;
          }
        });
      });
    },
  },
});

function rebuildTimeline(messages) {
  const out = [];
  const toolResultById = new Map();
  for (const m of messages) {
    if (m.role === 'tool') {
      let parsed = null;
      try { parsed = JSON.parse(m.content); } catch { parsed = { raw: m.content }; }
      toolResultById.set(m.tool_call_id, { name: m.name, parsed });
    }
  }
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content, created_at: m.created_at });
    } else if (m.role === 'assistant') {
      let tcs = null;
      if (m.tool_calls && m.tool_calls.length) {
        tcs = m.tool_calls.map((tc) => {
          let args = {};
          try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : (tc.args || {}); } catch {}
          const r = toolResultById.get(tc.id);
          const card = {
            id: tc.id,
            name: tc.function?.name || tc.name,
            args,
            status: r ? 'done' : 'pending',
            result: r?.parsed,
            stdout: r?.parsed?.stdout || '',
            stderr: r?.parsed?.stderr || '',
          };
          if (card.name === 'ask_user' && r?.parsed?.answer != null) {
            out.push({
              role: 'ask_answer',
              question: args.question,
              content: args.sensitive ? '••••••••' : String(r.parsed.answer),
              created_at: m.created_at,
            });
          }
          return card;
        }).filter((c) => c.name !== 'ask_user');
      }
      out.push({
        role: 'assistant',
        content: m.content,
        tool_calls: tcs,
        created_at: m.created_at,
        _streaming: false,
      });
    }
  }
  return out;
}
