<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import {
  Folder, FolderOpen, FileText, ArrowUp, RefreshCw, Save, X, Loader2,
  ChevronRight, ChevronDown, AlertTriangle, Home, Eye, EyeOff,
} from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import CopyButton from '@/components/CopyButton.vue';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open']);
const { t } = useI18n();

const cwd = ref(localStorage.getItem('aramis_fs_cwd') || '');
const entries = ref([]);
const loading = ref(false);
const err = ref('');
const showHidden = ref(localStorage.getItem('aramis_fs_hidden') === '1');

const home = ref('');
const sep = ref('/');

const selected = ref(null);    // entry being viewed/edited
const fileContent = ref('');
const origContent = ref('');
const fileLoading = ref(false);
const fileErr = ref('');

const visibleEntries = computed(() =>
  showHidden.value ? entries.value : entries.value.filter((e) => !e.hidden)
);

const isDirty = computed(() => fileContent.value !== origContent.value);

async function init() {
  try {
    const { home: h, cwd: c, sep: s } = await api.fsHome();
    home.value = h; sep.value = s || '/';
    if (!cwd.value) cwd.value = c || h;
    await load();
  } catch (e) { err.value = e.message; }
}

async function load() {
  err.value = '';
  loading.value = true;
  try {
    const { path, entries: list, parent } = await api.fsList(cwd.value);
    cwd.value = path;
    entries.value = list;
    localStorage.setItem('aramis_fs_cwd', cwd.value);
    window._lastParent = parent;
  } catch (e) {
    err.value = e.message;
  } finally { loading.value = false; }
}

async function goUp() {
  if (!window._lastParent) return;
  cwd.value = window._lastParent;
  selected.value = null;
  await load();
}

async function goHome() {
  cwd.value = home.value;
  selected.value = null;
  await load();
}

async function pickEntry(e) {
  if (e.type === 'dir') {
    cwd.value = e.path;
    selected.value = null;
    await load();
    return;
  }
  // file
  selected.value = e;
  fileErr.value = '';
  fileContent.value = '';
  origContent.value = '';
  fileLoading.value = true;
  try {
    const { content, binary, size } = await api.fsRead(e.path);
    if (binary) {
      fileErr.value = t('fs_binary_file');
      fileContent.value = '';
      origContent.value = '';
    } else {
      fileContent.value = content;
      origContent.value = content;
    }
  } catch (e) { fileErr.value = e.message; }
  finally { fileLoading.value = false; }
}

async function saveFile() {
  if (!selected.value) return;
  fileErr.value = '';
  fileLoading.value = true;
  try {
    await api.fsWrite(selected.value.path, fileContent.value);
    origContent.value = fileContent.value;
  } catch (e) { fileErr.value = e.message; }
  finally { fileLoading.value = false; }
}

function closeFile() {
  if (isDirty.value && !confirm(t('fs_unsaved_confirm'))) return;
  selected.value = null;
}

function toggleHidden() {
  showHidden.value = !showHidden.value;
  localStorage.setItem('aramis_fs_hidden', showHidden.value ? '1' : '0');
}

onMounted(init);
watch(() => props.open, (v) => { if (v && entries.value.length === 0) load(); });

function close() {
  if (isDirty.value && !confirm(t('fs_unsaved_confirm'))) return;
  emit('update:open', false);
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150"
    leave-active-class="transition duration-150"
    enter-from-class="translate-x-full rtl:-translate-x-full"
    leave-to-class="translate-x-full rtl:-translate-x-full"
  >
    <aside
      v-if="open"
      class="aramis-panel fixed top-0 bottom-0 ltr:right-0 rtl:left-0 w-full sm:w-[480px] md:w-[560px] z-50 bg-card border-s border-border flex flex-col shadow-2xl pb-[env(safe-area-inset-bottom)]"
    >
      <header class="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <Folder class="h-4 w-4 text-primary" />
        <div class="text-sm font-medium flex-1">{{ t('fs_title') }}</div>
        <Button variant="ghost" size="icon" @click="toggleHidden" :title="t('fs_toggle_hidden')">
          <Eye v-if="showHidden" class="h-4 w-4" />
          <EyeOff v-else class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click="load" :title="t('fs_refresh')">
          <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" />
        </Button>
        <Button variant="ghost" size="icon" @click="close" :title="t('close')">
          <X class="h-4 w-4" />
        </Button>
      </header>

      <!-- Path + toolbar -->
      <div class="px-3 py-2 border-b border-border flex items-center gap-1.5 text-xs">
        <Button variant="ghost" size="icon" @click="goUp" :title="t('fs_up')"><ArrowUp class="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" @click="goHome" :title="t('fs_home')"><Home class="h-3.5 w-3.5" /></Button>
        <div class="flex-1 min-w-0 rounded-md border border-input bg-background/60 px-2 py-1 flex items-center gap-1.5">
          <input
            v-model="cwd"
            @keydown.enter="load"
            dir="ltr"
            class="flex-1 bg-transparent outline-none text-xs font-mono"
          />
          <CopyButton :text="cwd" size="xs" />
        </div>
      </div>

      <div v-if="err" class="px-3 py-2 text-xs text-destructive flex items-center gap-2">
        <AlertTriangle class="h-3.5 w-3.5" /> {{ err }}
      </div>

      <!-- Browser + editor (split) -->
      <div class="flex-1 min-h-0 flex">
        <!-- Tree -->
        <div class="w-[42%] border-e border-border overflow-y-auto scrollbar-thin">
          <div v-if="loading && entries.length === 0" class="p-4 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 class="h-3.5 w-3.5 animate-spin" /> {{ t('loading') }}
          </div>
          <div v-else>
            <button
              v-for="e in visibleEntries"
              :key="e.path"
              class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-start hover:bg-accent transition truncate"
              :class="selected?.path === e.path && 'bg-primary/10'"
              @click="pickEntry(e)"
            >
              <Folder v-if="e.type === 'dir'" class="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <FileText v-else class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span class="truncate" :class="e.hidden && 'opacity-60'" dir="ltr">{{ e.name }}</span>
            </button>
            <div v-if="visibleEntries.length === 0" class="p-4 text-xs text-muted-foreground text-center">
              {{ t('fs_empty') }}
            </div>
          </div>
        </div>

        <!-- Editor -->
        <div class="flex-1 min-w-0 flex flex-col">
          <div v-if="!selected" class="flex-1 flex items-center justify-center text-xs text-muted-foreground p-6 text-center leading-6">
            {{ t('fs_pick_file') }}
          </div>
          <div v-else class="flex flex-col flex-1 min-h-0">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
              <FileText class="h-3.5 w-3.5 text-primary shrink-0" />
              <div class="text-xs font-mono truncate flex-1" dir="ltr">{{ selected.name }}</div>
              <span v-if="isDirty" class="text-[10px] text-amber-500">●</span>
              <CopyButton :text="fileContent" size="xs" />
              <Button variant="ghost" size="icon" @click="closeFile" :title="t('close')">
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>
            <div v-if="fileErr" class="px-3 py-2 text-[11px] text-destructive flex items-center gap-1.5">
              <AlertTriangle class="h-3 w-3" /> {{ fileErr }}
            </div>
            <textarea
              v-model="fileContent"
              spellcheck="false"
              dir="ltr"
              class="flex-1 min-h-0 bg-background/40 font-mono text-[12px] p-3 outline-none resize-none scrollbar-thin"
              :placeholder="t('fs_empty_file')"
              :readonly="fileLoading"
            />
            <div class="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
              <Loader2 v-if="fileLoading" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <Button size="sm" :disabled="!isDirty || fileLoading" @click="saveFile">
                <Save class="h-3.5 w-3.5" /> {{ t('save') }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>
