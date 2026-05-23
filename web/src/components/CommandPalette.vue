<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  Search, Plus, Settings, MessageSquare, Bot, Cpu, Sun, Moon, Globe,
  Folder, GitBranch, ChevronRight, Server, Download, Cog,
} from 'lucide-vue-next';
import { useChatStore } from '@/stores/chat';
import { useI18n } from '@/lib/i18n';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open', 'open-file-explorer', 'open-git-panel', 'open-hosts-panel', 'open-installer']);

const router = useRouter();
const store = useChatStore();
const { t, locale, setLocale } = useI18n();

const query = ref('');
const inputRef = ref(null);
const selIdx = ref(0);

const dark = computed(() => document.documentElement.classList.contains('dark'));
function toggleDark() {
  const next = !dark.value;
  document.documentElement.classList.toggle('dark', next);
  localStorage.setItem('aramis_theme', next ? 'dark' : 'light');
}

const commands = computed(() => {
  const items = [
    {
      group: 'actions',
      id: 'new-chat',
      title: t('cmd_new_chat'),
      hint: t('cmd_new_chat_hint'),
      icon: Plus,
      run: async () => { const id = await store.createChat(); router.replace({ name: 'chat', params: { id } }); },
    },
    {
      group: 'actions',
      id: 'new-claude',
      title: t('cmd_new_claude'),
      hint: t('cmd_new_claude_hint'),
      icon: Bot,
      run: async () => {
        store.setComposerMode('claude');
        const id = await store.createChat({ mode: 'claude' });
        router.replace({ name: 'chat', params: { id } });
      },
    },
    {
      group: 'actions',
      id: 'new-codex',
      title: t('cmd_new_codex'),
      hint: t('cmd_new_codex_hint'),
      icon: Cpu,
      run: async () => {
        store.setComposerMode('codex');
        const id = await store.createChat({ mode: 'codex' });
        router.replace({ name: 'chat', params: { id } });
      },
    },
    {
      group: 'panels',
      id: 'open-files',
      title: t('cmd_open_files'),
      hint: t('cmd_open_files_hint'),
      icon: Folder,
      run: () => emit('open-file-explorer'),
    },
    {
      group: 'panels',
      id: 'open-git',
      title: t('cmd_open_git'),
      hint: t('cmd_open_git_hint'),
      icon: GitBranch,
      run: () => emit('open-git-panel'),
    },
    {
      group: 'panels',
      id: 'open-hosts',
      title: t('cmd_open_hosts'),
      hint: t('cmd_open_hosts_hint'),
      icon: Server,
      run: () => emit('open-hosts-panel'),
    },
    {
      group: 'panels',
      id: 'open-installer',
      title: t('cmd_open_installer'),
      hint: t('cmd_open_installer_hint'),
      icon: Download,
      run: () => emit('open-installer', { tab: 'overview' }),
    },
    {
      group: 'actions',
      id: 'install-claude',
      title: t('cmd_install_claude'),
      icon: Bot,
      run: () => emit('open-installer', { tool: 'claude', tab: 'install' }),
    },
    {
      group: 'actions',
      id: 'install-codex',
      title: t('cmd_install_codex'),
      icon: Cpu,
      run: () => emit('open-installer', { tool: 'codex', tab: 'install' }),
    },
    {
      group: 'actions',
      id: 'configure-claude',
      title: t('cmd_configure_claude'),
      icon: Cog,
      run: () => emit('open-installer', { tool: 'claude', tab: 'configure' }),
    },
    {
      group: 'actions',
      id: 'configure-codex',
      title: t('cmd_configure_codex'),
      icon: Cog,
      run: () => emit('open-installer', { tool: 'codex', tab: 'configure' }),
    },
    {
      group: 'actions',
      id: 'settings',
      title: t('settings'),
      icon: Settings,
      run: () => router.push('/settings'),
    },
    {
      group: 'preferences',
      id: 'toggle-theme',
      title: dark.value ? t('cmd_light_mode') : t('cmd_dark_mode'),
      icon: dark.value ? Sun : Moon,
      run: () => toggleDark(),
    },
    {
      group: 'preferences',
      id: 'toggle-locale',
      title: locale.value === 'fa' ? 'Switch to English' : 'تغییر به فارسی',
      icon: Globe,
      run: () => setLocale(locale.value === 'fa' ? 'en' : 'fa'),
    },
  ];

  // Add quick-jump to recent chats
  for (const c of store.chats.slice(0, 30)) {
    items.push({
      group: 'chats',
      id: `chat:${c.id}`,
      title: c.title || t('new_chat'),
      hint: c.mode && c.mode !== 'aramis' ? `[${c.mode}]` : '',
      icon: MessageSquare,
      run: () => router.replace({ name: 'chat', params: { id: c.id } }),
    });
  }
  return items;
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return commands.value;
  return commands.value.filter((c) =>
    c.title?.toLowerCase().includes(q) || c.hint?.toLowerCase()?.includes(q)
  );
});

const grouped = computed(() => {
  const groups = new Map();
  for (const it of filtered.value) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group).push(it);
  }
  return [...groups.entries()];
});

watch(() => props.open, async (v) => {
  if (v) {
    query.value = '';
    selIdx.value = 0;
    await nextTick();
    inputRef.value?.focus();
  }
});

watch(filtered, () => { selIdx.value = 0; });

function close() { emit('update:open', false); }
async function run(cmd) {
  close();
  try { await cmd.run(); } catch (e) { console.error('[cmd]', e); }
}

function onKeydown(e) {
  if (!props.open) return;
  if (e.key === 'Escape') { close(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); selIdx.value = Math.min(filtered.value.length - 1, selIdx.value + 1); return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx.value = Math.max(0, selIdx.value - 1); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const item = filtered.value[selIdx.value];
    if (item) run(item);
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));

function groupLabel(g) {
  switch (g) {
    case 'actions':     return t('cmd_group_actions');
    case 'panels':      return t('cmd_group_panels');
    case 'chats':       return t('cmd_group_chats');
    case 'preferences': return t('cmd_group_preferences');
    default: return g;
  }
}

function flatIndex(group, idx) {
  let i = 0;
  for (const [g, items] of grouped.value) {
    if (g === group) return i + idx;
    i += items.length;
  }
  return -1;
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150"
    leave-active-class="transition duration-100"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-start justify-center p-3 sm:pt-[12vh] bg-black/40 backdrop-blur-sm"
      @click.self="close"
    >
      <div class="w-full max-w-xl rounded-xl border border-border bg-popover shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-3 border-b border-border">
          <Search class="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref="inputRef"
            v-model="query"
            :placeholder="t('cmd_palette_placeholder')"
            class="flex-1 bg-transparent border-0 outline-none text-sm"
          />
          <kbd class="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 font-mono" dir="ltr">esc</kbd>
        </div>
        <div class="max-h-[60vh] overflow-y-auto scrollbar-thin py-1">
          <div v-if="filtered.length === 0" class="text-center py-10 text-sm text-muted-foreground">
            {{ t('cmd_no_results') }}
          </div>
          <template v-for="[g, items] in grouped" :key="g">
            <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {{ groupLabel(g) }}
            </div>
            <button
              v-for="(it, i) in items"
              :key="it.id"
              type="button"
              :class="[
                'w-full flex items-center gap-2.5 px-3 py-2 text-start transition',
                flatIndex(g, i) === selIdx ? 'bg-primary/10' : 'hover:bg-accent',
              ]"
              @click="run(it)"
              @mousemove="selIdx = flatIndex(g, i)"
            >
              <component :is="it.icon" class="h-4 w-4 text-muted-foreground shrink-0" />
              <span class="flex-1 text-sm truncate" dir="auto">{{ it.title }}</span>
              <span v-if="it.hint" class="text-[11px] text-muted-foreground" dir="auto">{{ it.hint }}</span>
              <ChevronRight class="h-3 w-3 text-muted-foreground" />
            </button>
          </template>
        </div>
        <div class="border-t border-border bg-card/30 px-3 py-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
          <span dir="ltr">↑↓ navigate · ⏎ run · esc close</span>
          <span class="font-mono" dir="ltr">{{ filtered.length }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>
