import { defineStore } from 'pinia';
import { api } from '@/lib/api';

export const useChatStore = defineStore('chat', {
  state: () => ({
    chats: [],
    activeId: null,
    messages: [],       // canonical view of current chat
    streaming: false,
    phase: null,        // { phase: 'connecting'|'thinking'|'responding'|'tool_running', tool? }
    pendingAsk: null,   // { tool_call_id, question, sensitive }
    abortStream: null,
  }),
  actions: {
    async loadChats() {
      const { chats } = await api.listChats();
      this.chats = chats;
    },
    async createChat() {
      const chat = await api.createChat('');
      this.chats.unshift(chat);
      await this.openChat(chat.id);
      return chat.id;
    },
    async openChat(id) {
      const { chat, messages, pending_ask } = await api.getChat(id);
      this.activeId = chat.id;
      this.messages = rebuildTimeline(messages);
      this.pendingAsk = pending_ask || null;
      this.phase = null;
    },
    async renameChat(id, title) {
      await api.renameChat(id, title);
      const c = this.chats.find((x) => x.id === id); if (c) c.title = title;
    },
    async deleteChat(id) {
      await api.deleteChat(id);
      this.chats = this.chats.filter((c) => c.id !== id);
      if (this.activeId === id) {
        this.activeId = null;
        this.messages = [];
        this.pendingAsk = null;
        this.phase = null;
      }
    },

    pushUser(content) {
      this.messages.push({ role: 'user', content, created_at: Date.now() });
    },

    async sendMessage(content) {
      if (!this.activeId) await this.createChat();
      this.pushUser(content);
      await this._stream({ content });
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
      // Update local UI state on the matching tool card
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
            case 'tool_call':
              assistant.tool_calls.push({
                id: data.id,
                name: data.name,
                args: data.args,
                status: 'pending',
                stdout: '',
                stderr: '',
              });
              break;
            case 'tool_running': {
              const tc = assistant.tool_calls.find((t) => t.id === data.id);
              if (tc) tc.status = 'running';
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
              if (tc) { tc.status = 'done'; tc.result = data.result; }
              break;
            }
            case 'ask_user':
              this.pendingAsk = { tool_call_id: data.id, question: data.question, sensitive: !!data.sensitive };
              this.phase = null;
              break;
            case 'tool_approval': {
              // Find or create the tool card and mark it as awaiting approval.
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

/**
 * Server returns OpenAI-shaped messages: user / assistant / tool. The chat view
 * wants assistant bubbles with their tool_calls + results materialized as one unit,
 * plus inline rendering of the user's "ask_user" answers. This rebuilds that view.
 */
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
          try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
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
          // ask_user answers materialize as a separate timeline row.
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
