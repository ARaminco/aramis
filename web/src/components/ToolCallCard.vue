<script setup>
// Rich rendering for one tool call (Aramis Agent + Claude Code + Codex modes).
// Goals over the v0:
//   - Per-call duration (uses client-side timing the chat store now captures).
//   - Copy buttons on stdout / stderr / file contents for "stash it elsewhere"
//     workflows.
//   - Syntax highlight read_file content based on the file extension.
//   - Optional diff renderer when the server includes a unified diff in
//     `result.diff` (Claude Code's apply_patch emits one).
//   - Collapsible body (existing) + status pill on the header (existing) +
//     tool-specific summary that stays readable while the tool is running.

import { computed, ref, watch } from 'vue';
import {
  ChevronDown, Terminal, FileText, FilePlus, FolderTree, HelpCircle,
  Loader2, Check, X, Clock, Play, ShieldCheck, Copy, Edit3, Diff,
} from 'lucide-vue-next';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';      // html
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import ini from 'highlight.js/lib/languages/ini';
import nginx from 'highlight.js/lib/languages/nginx';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import diff from 'highlight.js/lib/languages/diff';
import { useI18n } from '@/lib/i18n';
import { useChatStore } from '@/stores/chat';
import CopyButton from '@/components/CopyButton.vue';

// Register exactly the languages we care about — keeps the chunk lean.
const LANGS = {
  javascript, js: javascript, mjs: javascript, cjs: javascript,
  typescript, ts: typescript, tsx: typescript,
  vue: xml, html: xml, htm: xml, xml,
  css, scss: css, sass: css, less: css,
  json, jsonc: json,
  python, py: python,
  bash, sh: bash, zsh: bash,
  yaml, yml: yaml,
  markdown, md: markdown,
  ini, conf: ini, env: ini,
  nginx,
  sql,
  go,
  rust, rs: rust,
  diff, patch: diff,
};
for (const [name, mod] of Object.entries({ javascript, typescript, xml, css, json, python, bash, yaml, markdown, ini, nginx, sql, go, rust, diff })) {
  hljs.registerLanguage(name, mod);
}

const props = defineProps({
  call: { type: Object, required: true },
});
const { t } = useI18n();
const chatStore = useChatStore();

const icon = computed(() => ({
  run_command: Terminal,
  read_file: FileText,
  write_file: FilePlus,
  edit_file: Edit3,
  apply_patch: Diff,
  list_dir: FolderTree,
  ask_user: HelpCircle,
})[props.call.name] || Terminal);

const toolLabel = computed(() => t(`tool_${props.call.name}`) || props.call.name);

const summary = computed(() => {
  const a = props.call.args || {};
  switch (props.call.name) {
    case 'run_command': return a.command || '';
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'apply_patch': return a.path || '';
    case 'list_dir': return a.path || '';
    case 'ask_user': return a.question || '';
    default: return JSON.stringify(a);
  }
});

const open = ref(true);
const r = computed(() => props.call.result);
const isPending = computed(() => !props.call.status || props.call.status === 'pending');
const isRunning = computed(() => props.call.status === 'running');
const isAwaitingApproval = computed(() => props.call.status === 'pending_approval');
const isDone = computed(() => props.call.status === 'done');
const isOk = computed(() => isDone.value && r.value && r.value.ok !== false);
const isFail = computed(() => isDone.value && r.value && r.value.ok === false);
const isDeclined = computed(() => isDone.value && r.value?.declined);

function approve() { chatStore.approveToolCall(props.call.id, true); }
function deny() { chatStore.approveToolCall(props.call.id, false); }

// Auto-collapse a few seconds after completion to keep the timeline tidy.
watch(isDone, (v) => {
  if (v && props.call.name !== 'run_command' && props.call.name !== 'read_file') {
    setTimeout(() => { open.value = false; }, 400);
  }
});

// Live combined output for run_command (interleave preserved by server order).
const liveOutput = computed(() => props.call.name === 'run_command' ? (props.call.stdout || '') : '');
const liveStderr = computed(() => props.call.stderr || '');

// --- Duration ------------------------------------------------------------
// Tick once per second while running so the header counter updates live.
const now = ref(Date.now());
let tickInterval = null;
watch(isRunning, (running) => {
  clearInterval(tickInterval);
  if (running) tickInterval = setInterval(() => { now.value = Date.now(); }, 1000);
}, { immediate: true });
import { onBeforeUnmount } from 'vue';
onBeforeUnmount(() => clearInterval(tickInterval));

function fmtDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

const duration = computed(() => {
  const c = props.call;
  if (!c.started_at) return '';
  const end = c.completed_at || (isRunning.value || isPending.value ? now.value : c.started_at);
  return fmtDuration(end - c.started_at);
});

// --- Syntax highlight for read_file --------------------------------------
function extOf(path) {
  if (!path) return '';
  const dot = path.lastIndexOf('.');
  if (dot < 0) return '';
  return path.slice(dot + 1).toLowerCase();
}

const readFileLang = computed(() => {
  if (props.call.name !== 'read_file') return null;
  const ext = extOf(props.call.args?.path);
  return LANGS[ext] ? ext : null;
});

const readFileHtml = computed(() => {
  if (props.call.name !== 'read_file' || !r.value?.content) return '';
  const content = r.value.content;
  if (!readFileLang.value) {
    // Plain text — still escape so HTML doesn't render.
    return escapeHtml(content);
  }
  try {
    return hljs.highlight(content, { language: readFileLang.value, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Unified diff renderer ----------------------------------------------
// Used when the agent returns a unified diff in result.diff (Claude Code's
// apply_patch / edit_file tools). Each + and - line gets a colored gutter.
const diffLines = computed(() => {
  const d = r.value?.diff || (props.call.name === 'edit_file' ? r.value?.unified : null);
  if (!d || typeof d !== 'string') return null;
  return d.split('\n').slice(0, 600).map((line) => ({
    text: line,
    kind: line.startsWith('+++') || line.startsWith('---') ? 'meta'
        : line.startsWith('+') ? 'add'
        : line.startsWith('-') ? 'del'
        : line.startsWith('@@') ? 'hunk'
        : 'ctx',
  }));
});

const diffSummary = computed(() => {
  if (!diffLines.value) return '';
  let add = 0, del = 0;
  for (const l of diffLines.value) {
    if (l.kind === 'add') add++;
    else if (l.kind === 'del') del++;
  }
  return { add, del };
});
</script>

<template>
  <div
    class="rounded-lg border bg-card/60 text-sm overflow-hidden transition-colors"
    :class="[
      isAwaitingApproval && 'border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]',
      isRunning && 'border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]',
      isFail && !isDeclined && 'border-destructive/40',
      isDeclined && 'border-border opacity-60',
      isOk && 'border-emerald-500/30',
    ]"
  >
    <!-- Header -->
    <button
      class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/40 transition text-start"
      @click="open = !open"
    >
      <component :is="icon" class="h-4 w-4 text-muted-foreground shrink-0" />
      <span class="text-xs font-medium text-muted-foreground shrink-0">{{ toolLabel }}</span>
      <span class="truncate text-xs flex-1 font-mono text-foreground/80 min-w-0" dir="ltr">{{ summary }}</span>

      <!-- Diff stat pill (when an apply_patch / edit_file finishes) -->
      <span v-if="diffLines && diffSummary && diffSummary.add + diffSummary.del > 0" class="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono" dir="ltr">
        <span v-if="diffSummary.add" class="text-emerald-500">+{{ diffSummary.add }}</span>
        <span v-if="diffSummary.del" class="text-red-500">−{{ diffSummary.del }}</span>
      </span>

      <!-- Live duration -->
      <span v-if="duration" class="text-[10px] font-mono text-muted-foreground tabular-nums hidden sm:inline" dir="ltr" :title="t('tool_duration')">
        {{ duration }}
      </span>

      <!-- Exit code badge for run_command -->
      <span
        v-if="props.call.name === 'run_command' && isDone && r"
        class="hidden md:inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded"
        :class="r.exit_code === 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'"
        dir="ltr"
      >
        exit {{ r.exit_code }}
      </span>

      <!-- Status pill -->
      <span v-if="isAwaitingApproval" class="flex items-center gap-1 text-[10px] text-blue-500">
        <ShieldCheck class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">{{ t('awaiting_approval') }}</span>
      </span>
      <span v-else-if="isPending" class="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock class="h-3 w-3" />
      </span>
      <span v-else-if="isRunning" class="flex items-center gap-1 text-[10px] text-amber-500">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        <span class="hidden sm:inline">{{ t('running') }}</span>
      </span>
      <span v-else-if="isOk" class="flex items-center gap-1 text-[10px] text-emerald-500">
        <Check class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">{{ t('done_state') }}</span>
      </span>
      <span v-else-if="isDeclined" class="flex items-center gap-1 text-[10px] text-muted-foreground">
        <X class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">{{ t('declined_state') }}</span>
      </span>
      <span v-else-if="isFail" class="flex items-center gap-1 text-[10px] text-destructive">
        <X class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">{{ t('failed_state') }}</span>
      </span>

      <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0" :class="open && 'rotate-180'" />
    </button>

    <!-- Body -->
    <div v-if="open" class="border-t bg-background/30 animate-fade-in">
      <div class="p-3 space-y-2">
        <!-- Manual approval gate -->
        <div v-if="isAwaitingApproval" class="rounded-md bg-blue-500/5 border border-blue-500/20 p-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div class="text-xs text-foreground/80 flex-1 leading-5">
            {{ t('approval_prompt') }}
          </div>
          <div class="flex gap-2 shrink-0">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition flex items-center gap-1.5"
              @click="approve"
            >
              <Play class="h-3 w-3" /> {{ t('approve') }}
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-muted/70 transition flex items-center gap-1.5"
              @click="deny"
            >
              <X class="h-3 w-3" /> {{ t('deny') }}
            </button>
          </div>
        </div>

        <details v-if="call.args && Object.keys(call.args).length" class="text-xs">
          <summary class="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground select-none">{{ t('args') }}</summary>
          <pre class="bg-muted/40 rounded p-2 mt-1 overflow-x-auto" dir="ltr">{{ JSON.stringify(call.args, null, 2) }}</pre>
        </details>

        <!-- ════ run_command: live terminal output ═══════════════════════ -->
        <template v-if="call.name === 'run_command'">
          <div class="rounded-md bg-black/85 text-[11.5px] font-mono overflow-hidden">
            <div class="px-3 py-1.5 flex items-center justify-between text-[10px] text-zinc-400 border-b border-white/5">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <span class="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                <span class="mx-2 truncate text-zinc-400" dir="ltr">{{ call.args?.cwd || '$' }}</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span v-if="isDone && r" dir="ltr">{{ t('exit_code') }}: {{ r.exit_code }} <span v-if="r.killed">{{ t('killed') }}</span></span>
                <span v-else-if="isRunning" class="text-amber-400 animate-pulse">●</span>
                <CopyButton
                  v-if="liveOutput || liveStderr"
                  :text="(liveOutput || '') + (liveStderr ? '\n' + liveStderr : '')"
                  size="xs"
                  class="text-zinc-400 hover:text-zinc-200"
                />
              </div>
            </div>
            <div class="px-3 py-2 max-h-72 overflow-auto scrollbar-thin" dir="ltr">
              <div class="text-emerald-400 whitespace-pre-wrap break-words">$ {{ summary }}</div>
              <pre v-if="liveOutput" class="text-zinc-100 whitespace-pre-wrap break-words">{{ liveOutput }}</pre>
              <pre v-if="liveStderr" class="text-red-300 whitespace-pre-wrap break-words">{{ liveStderr }}</pre>
              <span v-if="isRunning" class="inline-block h-3 w-1.5 bg-zinc-100 animate-pulse align-baseline" />
            </div>
          </div>
        </template>

        <!-- ════ read_file: syntax-highlighted ═══════════════════════════ -->
        <template v-else-if="call.name === 'read_file' && r">
          <div v-if="r.content != null" class="rounded-md bg-muted/30 overflow-hidden">
            <div class="flex items-center justify-between px-2.5 py-1.5 text-[10px] text-muted-foreground border-b border-border bg-muted/20">
              <span class="font-mono" dir="ltr">
                {{ readFileLang || 'text' }}
                <span v-if="r.size">· {{ r.size }} bytes</span>
                <span v-if="r.truncated" class="text-amber-500">· truncated</span>
              </span>
              <CopyButton :text="r.content" size="xs" />
            </div>
            <pre
              class="text-xs px-3 py-2 overflow-auto max-h-80 scrollbar-thin hljs whitespace-pre-wrap break-words leading-relaxed"
              dir="ltr"
              v-html="readFileHtml"
            />
          </div>
          <div v-else-if="r.error" class="text-xs text-destructive break-words leading-5">{{ r.error }}</div>
        </template>

        <!-- ════ list_dir ════════════════════════════════════════════════ -->
        <template v-else-if="call.name === 'list_dir' && r?.entries">
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs font-mono" dir="ltr">
            <span v-for="e in r.entries" :key="e.name" class="truncate flex items-center gap-1" :class="e.type === 'dir' ? 'text-blue-400' : 'text-foreground/80'">
              {{ e.type === 'dir' ? '📁' : '📄' }} {{ e.name }}
            </span>
          </div>
          <div v-if="r.entries.length === 0" class="text-xs text-muted-foreground italic">{{ t('fs_empty_dir') || '(empty)' }}</div>
        </template>

        <!-- ════ write_file ══════════════════════════════════════════════ -->
        <template v-else-if="call.name === 'write_file' && r">
          <div class="rounded-md bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-xs" dir="ltr">
            <div v-if="r.ok" class="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Check class="h-3.5 w-3.5" />
              <span class="font-mono">wrote {{ r.bytes_written || '?' }} bytes → {{ call.args.path }}</span>
            </div>
            <div v-else class="text-red-400 flex items-center gap-2">
              <X class="h-3.5 w-3.5" /> {{ r.error }}
            </div>
          </div>
        </template>

        <!-- ════ diff (apply_patch / edit_file) ══════════════════════════ -->
        <div v-if="diffLines" class="rounded-md bg-muted/30 overflow-hidden border border-border">
          <div class="flex items-center justify-between px-2.5 py-1.5 text-[10px] text-muted-foreground border-b border-border bg-muted/20">
            <span class="font-mono inline-flex items-center gap-2" dir="ltr">
              <Diff class="h-3 w-3" /> diff
              <span v-if="diffSummary.add" class="text-emerald-500">+{{ diffSummary.add }}</span>
              <span v-if="diffSummary.del" class="text-red-500">−{{ diffSummary.del }}</span>
              <span v-if="diffSummary.add + diffSummary.del === 0" class="italic">{{ t('diff_no_changes') }}</span>
            </span>
            <CopyButton :text="r?.diff || r?.unified || ''" size="xs" />
          </div>
          <pre class="text-[11px] font-mono overflow-auto max-h-80 scrollbar-thin leading-snug" dir="ltr">
            <template v-for="(l, i) in diffLines" :key="i"
              ><span
                :class="{
                  'block': true,
                  'bg-emerald-500/10 text-emerald-400': l.kind === 'add',
                  'bg-red-500/10 text-red-400': l.kind === 'del',
                  'text-cyan-500': l.kind === 'hunk',
                  'text-muted-foreground': l.kind === 'meta',
                  'text-foreground/80': l.kind === 'ctx',
                }"
                class="px-3"
              >{{ l.text }}</span></template>
          </pre>
        </div>

        <!-- ════ generic fallback ═══════════════════════════════════════ -->
        <template v-if="r && !['run_command','read_file','list_dir','write_file','edit_file','apply_patch'].includes(call.name)">
          <pre class="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-72 whitespace-pre-wrap break-words" dir="ltr">{{ JSON.stringify(r, null, 2) }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* highlight.js default colors come from the global stylesheet; nothing extra
   needed here. The .hljs class gives the right background fallback if the
   global stylesheet wasn't loaded. */
</style>
