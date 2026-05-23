<script setup>
// Integrated terminal — xterm in the browser ↔ node-pty on the server via
// the /api/terminal WebSocket. One xterm instance per mount; the parent
// keeps the panel alive across toggles (v-show) so the shell history isn't
// thrown away every time the user hides it.
//
// Keybindings (handled by xterm by default plus our additions):
//   - Cmd/Ctrl+C copies if there's a selection, otherwise it falls through
//     to the shell as ^C (SIGINT) — same behavior as Terminal.app and VS Code.
//   - Cmd/Ctrl+V pastes from the system clipboard.
//   - F11 toggles full-screen height inside the chat.

import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
import { X as XIcon, Plus, RotateCcw, Maximize2, Minimize2, Trash2, Loader2 } from 'lucide-vue-next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useI18n } from '@/lib/i18n';
import { useChatStore } from '@/stores/chat';
import Button from '@/components/ui/Button.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(['update:open']);

const { t } = useI18n();
const chatStore = useChatStore();

const containerRef = ref(null);
const xtermHostRef = ref(null);
const fullHeight = ref(false);
const status = ref('idle'); // idle | connecting | open | closed | error
const errorMsg = ref('');
const meta = ref(null); // { pid, shell, cwd, cols, rows }
const isDark = ref(document.documentElement.classList.contains('dark'));
const xtermBg = computed(() => isDark.value ? '#0b0b0e' : '#fafafa');

let term = null;
let fit = null;
let ws = null;
let resizeObserver = null;
let pingTimer = null;
let reconnectAttempts = 0;

// Pull the JWT directly — same key the rest of the app uses.
function token() { return localStorage.getItem('aramis_token') || ''; }

function theme() {
  const dark = document.documentElement.classList.contains('dark');
  return dark ? {
    background: '#0b0b0e',
    foreground: '#e5e7eb',
    cursor: '#22d3ee',
    cursorAccent: '#0b0b0e',
    selectionBackground: 'rgba(34, 211, 238, 0.25)',
    black: '#18181b',  red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
    blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#e5e7eb',
    brightBlack: '#52525b', brightRed: '#f87171', brightGreen: '#34d399',
    brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
    brightCyan: '#22d3ee', brightWhite: '#fafafa',
  } : {
    background: '#fafafa', foreground: '#18181b',
    cursor: '#0ea5e9', cursorAccent: '#fafafa',
    selectionBackground: 'rgba(14, 165, 233, 0.18)',
    black: '#27272a', red: '#dc2626', green: '#059669', yellow: '#d97706',
    blue: '#2563eb', magenta: '#9333ea', cyan: '#0891b2', white: '#52525b',
    brightBlack: '#3f3f46', brightRed: '#ef4444', brightGreen: '#10b981',
    brightYellow: '#f59e0b', brightBlue: '#3b82f6', brightMagenta: '#a855f7',
    brightCyan: '#06b6d4', brightWhite: '#18181b',
  };
}

function ensureTerm() {
  if (term) return;
  term = new Terminal({
    fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Cascadia Code", "Fira Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    convertEol: false,
    allowProposedApi: true,
    theme: theme(),
    macOptionIsMeta: true,
    rightClickSelectsWord: true,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(xtermHostRef.value);

  // Send keystrokes to the pty over the ws.
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Two-finger swipe + scroll wheel are already wired by xterm; nothing extra.
  // Copy/paste handled by xterm itself when the selection exists.

  // Refit whenever the panel resizes (window, sidebar toggle, devtools).
  resizeObserver = new ResizeObserver(() => fitAndNotify());
  resizeObserver.observe(xtermHostRef.value);
}

function fitAndNotify() {
  if (!term || !fit) return;
  try { fit.fit(); } catch { /* xterm hasn't measured yet */ }
  if (ws && ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

function buildWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const cwd = chatStore.composerCwd || '';
  const params = new URLSearchParams();
  params.set('token', token());
  if (cwd) params.set('cwd', cwd);
  if (term?.cols) params.set('cols', String(term.cols));
  if (term?.rows) params.set('rows', String(term.rows));
  return `${proto}//${location.host}/api/terminal?${params.toString()}`;
}

function connect() {
  if (!term) return;
  status.value = 'connecting';
  errorMsg.value = '';
  meta.value = null;
  try { ws?.close(); } catch {}
  ws = new WebSocket(buildWsUrl());

  ws.onopen = () => {
    status.value = 'open';
    reconnectAttempts = 0;
    // Send an explicit initial resize once xterm has measured itself.
    nextTick(() => fitAndNotify());
    // Heartbeat: server pings us every 30s; we send a "no-op" resize every
    // 60s as a safety belt so middlebox idle timers don't drop the conn.
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && term?.cols) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }, 60_000);
  };

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); }
    catch { return; }
    switch (msg.type) {
      case 'ready':
        meta.value = msg;
        if (msg.shell) {
          // Brief banner so users know what shell they're in.
          term.writeln(`\x1b[2m─── ${msg.shell} · ${msg.cwd} (pid ${msg.pid}) ───\x1b[0m`);
        }
        break;
      case 'data':
        term.write(msg.data);
        break;
      case 'exit':
        status.value = 'closed';
        term.writeln(`\x1b[2m\r\n─── shell exited (code ${msg.code}${msg.signal ? `, signal ${msg.signal}` : ''}) — press R to start a new one ───\x1b[0m`);
        break;
      case 'error':
        errorMsg.value = msg.message || 'terminal error';
        status.value = 'error';
        term.writeln(`\x1b[31m─── ${errorMsg.value} ───\x1b[0m`);
        break;
    }
  };

  ws.onerror = () => {
    if (status.value !== 'closed') {
      status.value = 'error';
      errorMsg.value = 'connection lost';
    }
  };

  ws.onclose = (e) => {
    clearInterval(pingTimer);
    if (status.value === 'open') status.value = 'closed';
    // Auto-reconnect once on a clean accidental close; never loop.
    if (e.code === 1006 && reconnectAttempts === 0 && props.open) {
      reconnectAttempts++;
      setTimeout(() => connect(), 400);
    }
  };
}

function restart() {
  if (!term) return;
  term.reset();
  connect();
}

function clearScreen() {
  term?.reset();
}

function close() { emit('update:open', false); }
function toggleFull() { fullHeight.value = !fullHeight.value; nextTick(() => fitAndNotify()); }

// Lifecycle: instantiate xterm once when first opened, keep it alive after.
watch(() => props.open, async (v) => {
  if (v) {
    await nextTick();
    ensureTerm();
    if (!ws || ws.readyState >= 2 /* CLOSING/CLOSED */) connect();
    await nextTick();
    fitAndNotify();
    term?.focus();
  }
});

// Window resize → refit
function onWinResize() { fitAndNotify(); }
onMounted(() => {
  window.addEventListener('resize', onWinResize);
  // Esc to close, F11 to toggle full-height (when the panel has focus)
  containerRef.value?.addEventListener('keydown', (e) => {
    if (e.key === 'F11') { e.preventDefault(); toggleFull(); }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize);
  clearInterval(pingTimer);
  try { ws?.close(1000, 'unmount'); } catch {}
  try { resizeObserver?.disconnect(); } catch {}
  try { term?.dispose(); } catch {}
  term = null;
  fit = null;
  ws = null;
});

// Re-theme when the user flips light/dark.
const observer = new MutationObserver(() => {
  isDark.value = document.documentElement.classList.contains('dark');
  if (term) term.options.theme = theme();
});
onMounted(() => observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }));
onBeforeUnmount(() => observer.disconnect());

const statusLabel = computed(() => {
  switch (status.value) {
    case 'connecting': return t('term_connecting');
    case 'open':       return meta.value?.shell ? `${meta.value.shell.split('/').pop()}` : t('term_ready');
    case 'closed':     return t('term_closed');
    case 'error':      return errorMsg.value || t('term_error');
    default:           return t('term_idle');
  }
});
const statusColor = computed(() => ({
  connecting: 'text-amber-500',
  open:       'text-emerald-500',
  closed:     'text-muted-foreground',
  error:      'text-destructive',
  idle:       'text-muted-foreground',
}[status.value] || 'text-muted-foreground'));
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-full opacity-0"
      leave-to-class="translate-y-full opacity-0"
    >
      <div
        v-show="open"
        ref="containerRef"
        :class="[
          'fixed left-0 right-0 bottom-0 z-50 bg-card border-t border-border shadow-2xl flex flex-col',
          fullHeight ? 'top-0' : 'h-[55vh] min-h-[280px]',
        ]"
        role="dialog"
        :aria-label="t('terminal_title')"
      >
        <!-- Title bar -->
        <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/40 select-none">
          <div class="flex items-center gap-1 text-xs">
            <span class="h-2 w-2 rounded-full" :class="statusColor.replace('text-', 'bg-')" />
            <span class="font-medium">{{ t('terminal_title') }}</span>
            <span class="text-muted-foreground hidden sm:inline">·</span>
            <span :class="['text-[10.5px] font-mono', statusColor]" dir="ltr">{{ statusLabel }}</span>
          </div>
          <div v-if="meta?.cwd" class="text-[10.5px] text-muted-foreground font-mono truncate hidden md:inline px-1.5" dir="ltr" :title="meta.cwd">
            📂 {{ meta.cwd }}
          </div>
          <div class="flex-1" />
          <Button variant="ghost" size="icon" class="h-7 w-7" @click="clearScreen" :title="t('term_clear')">
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="h-7 w-7" @click="restart" :title="t('term_restart')">
            <RotateCcw class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="h-7 w-7" @click="toggleFull" :title="t('term_full')">
            <Minimize2 v-if="fullHeight" class="h-3.5 w-3.5" />
            <Maximize2 v-else class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="h-7 w-7" @click="close" :title="t('close')">
            <XIcon class="h-4 w-4" />
          </Button>
        </div>

        <!-- xterm host -->
        <div
          ref="xtermHostRef"
          class="flex-1 min-h-0 p-2"
          :style="{ background: xtermBg }"
        />

        <!-- Connecting overlay -->
        <div
          v-if="status === 'connecting' && !meta"
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div class="flex items-center gap-2 text-xs text-muted-foreground bg-card/80 backdrop-blur px-3 py-1.5 rounded-full border border-border">
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            {{ t('term_connecting') }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
