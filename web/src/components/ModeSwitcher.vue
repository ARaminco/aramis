<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { Bot, Sparkles, Cpu, ChevronDown, Check, AlertCircle, Folder } from 'lucide-vue-next';
import { useChatStore } from '@/stores/chat';
import { useI18n } from '@/lib/i18n';

const props = defineProps({
  mode: { type: String, default: 'aramis' },
});
const emit = defineEmits(['update:mode', 'change-cwd']);

const store = useChatStore();
const { t } = useI18n();
const open = ref(false);

const MODES = [
  { id: 'aramis', icon: Sparkles, label: 'mode_aramis', sub: 'mode_aramis_sub' },
  { id: 'claude', icon: Bot,      label: 'mode_claude', sub: 'mode_claude_sub', requires: 'claude' },
  { id: 'codex',  icon: Cpu,      label: 'mode_codex',  sub: 'mode_codex_sub',  requires: 'codex'  },
];

const cliTools = computed(() => store.detectedCLIs || []);
const isInstalled = (id) => {
  if (id === 'aramis') return true;
  const t = cliTools.value.find((x) => x.id === id);
  return !!t?.installed;
};

const current = computed(() => MODES.find((m) => m.id === props.mode) || MODES[0]);

async function setMode(m) {
  open.value = false;
  if (m.id === props.mode) return;
  if (!isInstalled(m.id)) return;
  emit('update:mode', m.id);
}

function onCwdChange(e) {
  emit('change-cwd', e.target.value);
}

// Detect CLIs once when the dropdown is first opened.
let detected = false;
watch(open, async (v) => {
  if (v && !detected) {
    detected = true;
    if (!cliTools.value || cliTools.value.length === 0) await store.detectCLIs();
  }
});

const rootEl = ref(null);
function onDocClick(e) {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocClick));
onUnmounted(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-lg border border-border bg-card/60 hover:bg-accent transition px-2.5 py-1.5 text-xs"
      @click="open = !open"
      :title="t('mode_switcher')"
    >
      <component :is="current.icon" class="h-3.5 w-3.5 text-primary" />
      <span class="font-medium">{{ t(current.label) }}</span>
      <ChevronDown class="h-3 w-3 text-muted-foreground" :class="open && 'rotate-180'" />
    </button>

    <Transition
      enter-active-class="transition duration-150"
      leave-active-class="transition duration-100"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="open"
        class="absolute bottom-full mb-2 z-30 w-[280px] rounded-xl border border-border bg-popover shadow-lg p-2 space-y-1"
        :class="{ 'rtl:right-0 ltr:left-0': true }"
      >
        <div class="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {{ t('agent_backend') }}
        </div>
        <button
          v-for="m in MODES" :key="m.id"
          type="button"
          @click="setMode(m)"
          :disabled="!isInstalled(m.id)"
          :class="[
            'w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-start transition',
            props.mode === m.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent',
            !isInstalled(m.id) && 'opacity-50 cursor-not-allowed hover:bg-transparent',
          ]"
        >
          <component :is="m.icon" class="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium">{{ t(m.label) }}</span>
              <Check v-if="props.mode === m.id" class="h-3 w-3 text-primary" />
              <span
                v-if="m.id !== 'aramis' && !isInstalled(m.id)"
                class="text-[10px] text-amber-500 flex items-center gap-1"
              >
                <AlertCircle class="h-3 w-3" />
                {{ t('not_installed') }}
              </span>
            </div>
            <div class="text-[11px] text-muted-foreground leading-snug">{{ t(m.sub) }}</div>
          </div>
        </button>

        <div class="border-t border-border my-1 pt-2 px-2 space-y-1.5">
          <label class="block text-[10px] uppercase tracking-wider text-muted-foreground">
            {{ t('working_dir') }}
          </label>
          <div class="flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-2 py-1">
            <Folder class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              :value="store.activeCwd || store.composerCwd"
              @change="onCwdChange"
              dir="ltr"
              :placeholder="t('cwd_placeholder')"
              class="flex-1 bg-transparent border-0 outline-none text-xs font-mono"
            />
          </div>
          <p class="text-[10px] text-muted-foreground leading-snug">{{ t('cwd_hint') }}</p>
        </div>
      </div>
    </Transition>
  </div>
</template>
