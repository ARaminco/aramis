<script setup>
import { ref, computed, watch } from 'vue';
import { Bot, Cpu, Download, Folder, RefreshCw, X, Loader2, AlertCircle } from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useChatStore } from '@/stores/chat';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open', 'imported']);
const { t } = useI18n();
const store = useChatStore();

const tool = ref('claude');
const sessions = ref([]);
const loading = ref(false);
const err = ref('');

async function load() {
  loading.value = true;
  err.value = '';
  try {
    const r = await api.listCLISessions(tool.value);
    sessions.value = r.sessions || [];
  } catch (e) { err.value = e.message; sessions.value = []; }
  finally { loading.value = false; }
}

async function adopt(s) {
  const title = (s.preview || '').slice(0, 60) || `${tool.value} ${s.session_id.slice(0,8)}`;
  await store.createChat({
    title,
    mode: tool.value,
    external_session_id: s.session_id,
    cwd: s.project ? decodeClaudeProject(s.project) : '',
  });
  emit('imported', { tool: tool.value, session_id: s.session_id });
  emit('update:open', false);
}

function decodeClaudeProject(slug) {
  // Claude Code uses '-' as a path separator slug. We can't perfectly invert it
  // (a literal '-' in a path becomes ambiguous), but '/' is by far the most common.
  if (!slug) return '';
  return '/' + slug.replace(/^-+/, '').replace(/-/g, '/');
}

watch(() => [props.open, tool.value], () => { if (props.open) load(); });

function close() { emit('update:open', false); }
</script>

<template>
  <Dialog :open="open" :title="t('import_sessions')" @update:open="(v) => emit('update:open', v)">
    <div class="space-y-3">
      <!-- Tool tabs -->
      <div class="flex gap-1 p-1 rounded-lg bg-muted/40 w-fit">
        <button
          type="button"
          @click="tool = 'claude'"
          :class="[
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition',
            tool === 'claude' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
          ]"
        >
          <Bot class="h-3.5 w-3.5" /> Claude Code
        </button>
        <button
          type="button"
          @click="tool = 'codex'"
          :class="[
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition',
            tool === 'codex' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
          ]"
        >
          <Cpu class="h-3.5 w-3.5" /> Codex
        </button>
        <Button variant="ghost" size="icon" @click="load" :title="t('fs_refresh')">
          <RefreshCw class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
        </Button>
      </div>

      <p class="text-[11px] text-muted-foreground leading-5">{{ t('import_sessions_hint') }}</p>

      <div v-if="err" class="text-xs text-destructive flex items-center gap-2">
        <AlertCircle class="h-3.5 w-3.5" /> {{ err }}
      </div>

      <div class="max-h-[50vh] overflow-y-auto scrollbar-thin space-y-1.5">
        <div v-if="loading" class="text-center py-8 text-xs text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin inline" /> {{ t('loading') }}
        </div>
        <div v-else-if="sessions.length === 0" class="text-center py-8 text-xs text-muted-foreground">
          {{ t('import_no_sessions') }}
        </div>
        <button
          v-for="s in sessions" :key="s.session_id"
          class="w-full rounded-md border border-border bg-card/40 hover:bg-accent transition p-2.5 text-start"
          @click="adopt(s)"
        >
          <div class="flex items-center gap-2 mb-1">
            <Folder class="h-3 w-3 text-muted-foreground shrink-0" />
            <span class="text-[11px] font-mono text-muted-foreground truncate flex-1" dir="ltr">{{ s.project || s.file }}</span>
            <Download class="h-3.5 w-3.5 text-primary" />
          </div>
          <div class="text-xs leading-snug line-clamp-2" dir="auto">{{ s.preview }}</div>
          <div class="text-[10px] text-muted-foreground mt-1 flex items-center gap-2" dir="ltr">
            <span class="font-mono">{{ s.session_id.slice(0, 12) }}…</span>
            <span>·</span>
            <span>{{ new Date(s.updated_at).toLocaleString() }}</span>
          </div>
        </button>
      </div>

      <div class="flex justify-end pt-1">
        <Button variant="outline" @click="close">{{ t('close') }}</Button>
      </div>
    </div>
  </Dialog>
</template>
