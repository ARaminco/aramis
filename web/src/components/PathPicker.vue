<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import {
  Folder, FolderOpen, ArrowUp, Home, RefreshCw, Check, X, Loader2,
  AlertTriangle, ChevronRight, Eye, EyeOff,
} from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import CopyButton from '@/components/CopyButton.vue';

const props = defineProps({
  open: Boolean,
  initialPath: { type: String, default: '' },
  title: { type: String, default: '' },
});
const emit = defineEmits(['update:open', 'pick']);
const { t } = useI18n();

const cwd = ref('');
const entries = ref([]);
const loading = ref(false);
const err = ref('');
const showHidden = ref(false);
const parent = ref('');
const home = ref('');

const visible = computed(() => {
  if (showHidden.value) return entries.value;
  return entries.value.filter((e) => !e.hidden);
});

async function init() {
  try {
    const { home: h, cwd: c } = await api.fsHome();
    home.value = h;
    if (!cwd.value) cwd.value = props.initialPath || c || h;
    await load();
  } catch (e) { err.value = e.message; }
}

async function load() {
  if (!cwd.value) return;
  err.value = '';
  loading.value = true;
  try {
    const r = await api.fsList(cwd.value);
    cwd.value = r.path;
    parent.value = r.parent;
    // Show directories only — file selection isn't what this picker is for.
    entries.value = (r.entries || []).filter((e) => e.type === 'dir');
  } catch (e) { err.value = e.message; entries.value = []; }
  finally { loading.value = false; }
}

async function enter(e) {
  cwd.value = e.path;
  await load();
}
async function up() {
  if (parent.value && parent.value !== cwd.value) {
    cwd.value = parent.value;
    await load();
  }
}
async function goHome() {
  cwd.value = home.value;
  await load();
}

function pick() {
  emit('pick', cwd.value);
  emit('update:open', false);
}

watch(() => props.open, async (v) => {
  if (v) { cwd.value = props.initialPath || ''; await init(); }
});
watch(() => props.initialPath, (v) => {
  if (props.open && v && v !== cwd.value) { cwd.value = v; load(); }
});
</script>

<template>
  <Dialog
    :open="open"
    :title="title || t('path_picker_title')"
    size="lg"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-3 min-h-0">
      <!-- Path bar -->
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" @click="up" :disabled="!parent || parent === cwd" :title="t('fs_up')">
          <ArrowUp class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" @click="goHome" :title="t('fs_home')">
          <Home class="h-3.5 w-3.5" />
        </Button>
        <div class="flex-1 min-w-0 rounded-md border border-input bg-background/60 px-2 py-1.5 flex items-center gap-1.5">
          <input
            v-model="cwd"
            @keydown.enter="load"
            dir="ltr"
            class="flex-1 min-w-0 bg-transparent outline-none text-xs font-mono"
            spellcheck="false"
          />
          <CopyButton :text="cwd" size="xs" />
        </div>
        <Button variant="ghost" size="icon" @click="load" :title="t('fs_refresh')">
          <RefreshCw class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
        </Button>
        <Button variant="ghost" size="icon" @click="showHidden = !showHidden" :title="t('fs_toggle_hidden')">
          <Eye v-if="showHidden" class="h-3.5 w-3.5" />
          <EyeOff v-else class="h-3.5 w-3.5" />
        </Button>
      </div>

      <div v-if="err" class="text-xs text-destructive flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
        <AlertTriangle class="h-3.5 w-3.5" /> {{ err }}
      </div>

      <!-- Directory list -->
      <div class="rounded-md border border-border bg-card/40 max-h-[50vh] overflow-y-auto scrollbar-thin">
        <div v-if="loading && entries.length === 0" class="p-4 text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 class="h-3.5 w-3.5 animate-spin" /> {{ t('loading') }}
        </div>
        <div v-else-if="visible.length === 0" class="p-6 text-xs text-muted-foreground text-center">
          {{ t('path_picker_empty') }}
        </div>
        <button
          v-for="e in visible" :key="e.path"
          @dblclick="enter(e)"
          @click="enter(e)"
          class="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition text-start border-t border-border first:border-t-0"
        >
          <Folder class="h-3.5 w-3.5 text-blue-500 shrink-0" :class="e.hidden && 'opacity-50'" />
          <span class="truncate flex-1 font-mono" :class="e.hidden && 'opacity-60'" dir="ltr">{{ e.name }}</span>
          <ChevronRight class="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      <p class="text-[10.5px] text-muted-foreground leading-snug">{{ t('path_picker_hint') }}</p>

      <div class="flex justify-end gap-2 pt-1">
        <Button variant="outline" @click="emit('update:open', false)">{{ t('cancel') }}</Button>
        <Button :disabled="!cwd" @click="pick">
          <Check class="h-4 w-4" />
          {{ t('path_picker_select_current') }}
        </Button>
      </div>
    </div>
  </Dialog>
</template>
