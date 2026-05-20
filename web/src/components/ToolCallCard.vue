<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronDown, Terminal, FileText, FilePlus, FolderTree, HelpCircle, Loader2, Check, X, Clock, Play, ShieldCheck } from 'lucide-vue-next';
import { useI18n } from '@/lib/i18n';
import { useChatStore } from '@/stores/chat';

const props = defineProps({
  call: { type: Object, required: true },
});
const { t } = useI18n();
const chatStore = useChatStore();

const icon = computed(() => ({
  run_command: Terminal,
  read_file: FileText,
  write_file: FilePlus,
  list_dir: FolderTree,
  ask_user: HelpCircle,
})[props.call.name] || Terminal);

const toolLabel = computed(() => t(`tool_${props.call.name}`) || props.call.name);

const summary = computed(() => {
  const a = props.call.args || {};
  switch (props.call.name) {
    case 'run_command': return a.command || '';
    case 'read_file':
    case 'write_file': return a.path || '';
    case 'list_dir': return a.path || '';
    case 'ask_user': return a.question || '';
    default: return JSON.stringify(a);
  }
});

const open = ref(true); // expanded by default while running so user sees progress
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
  if (v && props.call.name !== 'run_command') {
    setTimeout(() => { open.value = false; }, 400);
  }
});

// Live combined output for run_command (interleave preserved by server order).
const liveOutput = computed(() => {
  if (props.call.name !== 'run_command') return '';
  return props.call.stdout || '';
});
const liveStderr = computed(() => props.call.stderr || '');
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
    <button
      class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/40 transition text-start"
      @click="open = !open"
    >
      <component :is="icon" class="h-4 w-4 text-muted-foreground shrink-0" />
      <span class="text-xs font-medium text-muted-foreground shrink-0">{{ toolLabel }}</span>
      <span class="truncate text-xs flex-1 font-mono text-foreground/80 min-w-0" dir="ltr">{{ summary }}</span>

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

        <!-- run_command: live terminal output -->
        <template v-if="call.name === 'run_command'">
          <div class="rounded-md bg-black/85 text-[11.5px] font-mono overflow-hidden">
            <div class="px-3 py-1.5 flex items-center justify-between text-[10px] text-zinc-400 border-b border-white/5">
              <div class="flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <span class="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                <span class="mx-2 truncate" dir="ltr">{{ call.args?.cwd || '$' }}</span>
              </div>
              <span v-if="isDone && r" dir="ltr">{{ t('exit_code') }}: {{ r.exit_code }} <span v-if="r.killed">{{ t('killed') }}</span></span>
              <span v-else-if="isRunning" class="text-amber-400 animate-pulse">●</span>
            </div>
            <div class="px-3 py-2 max-h-72 overflow-auto scrollbar-thin" dir="ltr">
              <div class="text-emerald-400 whitespace-pre-wrap break-words">$ {{ summary }}</div>
              <pre v-if="liveOutput" class="text-zinc-100 whitespace-pre-wrap break-words">{{ liveOutput }}</pre>
              <pre v-if="liveStderr" class="text-red-300 whitespace-pre-wrap break-words">{{ liveStderr }}</pre>
              <span v-if="isRunning" class="inline-block h-3 w-1.5 bg-zinc-100 animate-pulse align-baseline" />
            </div>
          </div>
        </template>

        <!-- read_file -->
        <template v-else-if="call.name === 'read_file' && r">
          <pre class="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-72 whitespace-pre-wrap break-words" dir="ltr">{{ r.content || r.error }}</pre>
          <div v-if="r.size" class="text-[10px] text-muted-foreground" dir="ltr">size: {{ r.size }} bytes{{ r.truncated ? ' • truncated' : '' }}</div>
        </template>

        <!-- list_dir -->
        <template v-else-if="call.name === 'list_dir' && r?.entries">
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs font-mono" dir="ltr">
            <span v-for="e in r.entries" :key="e.name" class="truncate" :class="e.type === 'dir' ? 'text-blue-400' : 'text-foreground/80'">
              {{ e.type === 'dir' ? '📁' : '📄' }} {{ e.name }}
            </span>
          </div>
        </template>

        <!-- write_file -->
        <template v-else-if="call.name === 'write_file' && r">
          <div class="text-xs" dir="ltr">
            <span v-if="r.ok" class="text-emerald-400">✓ wrote {{ r.bytes_written }} bytes → {{ call.args.path }}</span>
            <span v-else class="text-red-400">✗ {{ r.error }}</span>
          </div>
        </template>

        <!-- generic -->
        <template v-else-if="r">
          <pre class="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-72 whitespace-pre-wrap break-words" dir="ltr">{{ JSON.stringify(r, null, 2) }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>
