<script setup>
import { ref, computed, watch } from 'vue';
import {
  Bot, Cpu, Download, Folder, RefreshCw, Loader2, AlertCircle, ChevronRight, ChevronDown,
  Search,
} from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useChatStore } from '@/stores/chat';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Badge from '@/components/ui/Badge.vue';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open', 'imported']);
const { t } = useI18n();
const store = useChatStore();

const tool = ref('claude');
const sessions = ref([]);
const loading = ref(false);
const err = ref('');
const search = ref('');
const expandedProjects = ref(new Set());

async function load() {
  loading.value = true;
  err.value = '';
  try {
    const r = await api.listCLISessions(tool.value);
    sessions.value = r.sessions || [];
    // By default expand every project so the first session in each is reachable.
    expandedProjects.value = new Set(groupedProjects.value.map((g) => g.project));
  } catch (e) { err.value = e.message; sessions.value = []; }
  finally { loading.value = false; }
}

function decodeClaudeProject(slug) {
  // Claude Code's project slug replaces "/" with "-". We can't perfectly invert
  // (a literal "-" becomes ambiguous), but "/" is by far the most common.
  if (!slug) return '';
  return '/' + slug.replace(/^-+/, '').replace(/-/g, '/');
}

function shortProject(p) {
  if (!p) return t('hosts_ftp_label');
  const decoded = decodeClaudeProject(p);
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length <= 2) return decoded;
  return '…/' + parts.slice(-2).join('/');
}

// ---- Grouping --------------------------------------------------------
// Group sessions by project slug. Project keys come from Claude Code's
// directory layout (`~/.claude/projects/<slug>`). Codex sessions don't have
// project info — they get bucketed into a single "All sessions" group.

const filteredSessions = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return sessions.value;
  return sessions.value.filter((s) =>
    (s.preview || '').toLowerCase().includes(q) ||
    (s.project || '').toLowerCase().includes(q) ||
    (s.session_id || '').toLowerCase().includes(q)
  );
});

const groupedProjects = computed(() => {
  const map = new Map();
  for (const s of filteredSessions.value) {
    const key = s.project || '__all__';
    if (!map.has(key)) map.set(key, { project: key, label: shortProject(key === '__all__' ? null : key), full_path: key === '__all__' ? '' : decodeClaudeProject(key), sessions: [], latest: 0 });
    const g = map.get(key);
    g.sessions.push(s);
    if (s.updated_at > g.latest) g.latest = s.updated_at;
  }
  return Array.from(map.values()).sort((a, b) => b.latest - a.latest);
});

function toggleProject(p) {
  const next = new Set(expandedProjects.value);
  if (next.has(p)) next.delete(p); else next.add(p);
  expandedProjects.value = next;
}

async function adopt(s) {
  const title = (s.preview || '').slice(0, 60).trim() || `${tool.value} ${s.session_id.slice(0, 8)}`;
  await store.createChat({
    title,
    mode: tool.value,
    external_session_id: s.session_id,
    cwd: s.project ? decodeClaudeProject(s.project) : '',
  });
  emit('imported', { tool: tool.value, session_id: s.session_id });
  emit('update:open', false);
}

watch(() => [props.open, tool.value], () => { if (props.open) load(); });

function close() { emit('update:open', false); }

function relTime(ms) {
  if (!ms) return '';
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}
</script>

<template>
  <Dialog :open="open" :title="t('import_sessions')" size="lg" @update:open="(v) => emit('update:open', v)">
    <div class="flex flex-col gap-3 min-h-0">
      <!-- Tool tabs + search (stack on mobile) -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-2">
        <div class="flex gap-1 p-1 rounded-lg bg-muted/40 self-start">
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
        </div>
        <div class="flex-1 relative">
          <Search class="absolute top-1/2 -translate-y-1/2 ltr:left-2.5 rtl:right-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            v-model="search"
            type="text"
            :placeholder="t('import_search_ph')"
            class="w-full rounded-md border border-input bg-transparent ltr:pl-8 rtl:pr-8 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
        <Button variant="ghost" size="icon" @click="load" :title="t('fs_refresh')" class="self-start sm:self-auto">
          <RefreshCw class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
        </Button>
      </div>

      <p class="text-[11px] text-muted-foreground leading-snug">{{ t('import_sessions_hint') }}</p>

      <div v-if="err" class="text-xs text-destructive flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
        <AlertCircle class="h-3.5 w-3.5 shrink-0" /> {{ err }}
      </div>

      <!-- Project groups — collapsible, sorted by most recent activity. -->
      <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-4 sm:mx-0 px-4 sm:px-0">
        <div v-if="loading" class="text-center py-10 text-xs text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin inline" /> {{ t('loading') }}
        </div>
        <div v-else-if="groupedProjects.length === 0" class="text-center py-10 text-xs text-muted-foreground">
          {{ search ? t('search_no_results') : t('import_no_sessions') }}
        </div>

        <div v-else class="space-y-1.5">
          <div
            v-for="g in groupedProjects" :key="g.project"
            class="rounded-lg border border-border bg-card/40 overflow-hidden"
          >
            <!-- Group header -->
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-accent/40 transition"
              @click="toggleProject(g.project)"
            >
              <ChevronDown v-if="expandedProjects.has(g.project)" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <ChevronRight v-else class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Folder class="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-[12px] font-medium truncate" dir="ltr" :title="g.full_path">{{ g.label }}</div>
                <div class="text-[10px] text-muted-foreground" dir="ltr">{{ g.sessions.length }} sessions · {{ relTime(g.latest) }}</div>
              </div>
              <Badge variant="outline" class="text-[10px] shrink-0">{{ g.sessions.length }}</Badge>
            </button>

            <!-- Sessions in this group -->
            <div v-if="expandedProjects.has(g.project)" class="border-t border-border divide-y divide-border/60">
              <button
                v-for="s in g.sessions" :key="s.session_id"
                type="button"
                @click="adopt(s)"
                class="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-accent/40 transition text-start"
              >
                <div class="flex-1 min-w-0 space-y-1">
                  <div class="text-xs leading-snug line-clamp-2" dir="auto">{{ s.preview || '(no preview)' }}</div>
                  <div class="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap" dir="ltr">
                    <span class="font-mono">{{ s.session_id.slice(0, 10) }}…</span>
                    <span>·</span>
                    <span>{{ relTime(s.updated_at) }}</span>
                  </div>
                </div>
                <div class="shrink-0 inline-flex items-center gap-1 text-[11px] text-primary">
                  <Download class="h-3.5 w-3.5" /> <span class="hidden sm:inline">{{ t('import_adopt') }}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end pt-1">
        <Button variant="outline" @click="close">{{ t('close') }}</Button>
      </div>
    </div>
  </Dialog>
</template>
