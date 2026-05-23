<script setup>
import { ref, computed, watch } from 'vue';
import {
  GitBranch, GitCommit, RefreshCw, X, Plus, Minus, FileText, AlertTriangle,
  CheckSquare, Square, Loader2,
} from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import CopyButton from '@/components/CopyButton.vue';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open']);
const { t } = useI18n();

const repoPath = ref(localStorage.getItem('aramis_git_path') || '');
const data = ref(null);     // {is_repo, branch, files, log, ...}
const loading = ref(false);
const err = ref('');
const message = ref('');
const selectedFiles = ref(new Set());
const diff = ref('');
const diffFor = ref(null);   // {file, staged}
const diffLoading = ref(false);
const commitMsg = ref('');
const commitMsgErr = ref('');

async function refresh() {
  if (!repoPath.value) return;
  loading.value = true;
  err.value = '';
  message.value = '';
  try {
    data.value = await api.gitStatus(repoPath.value);
    if (!data.value.is_repo) {
      err.value = t('git_not_repo');
    }
    localStorage.setItem('aramis_git_path', repoPath.value);
  } catch (e) {
    err.value = e.message;
    data.value = null;
  } finally { loading.value = false; }
}

function fileChecked(f) { return selectedFiles.value.has(f.path); }
function toggleFile(f) {
  if (selectedFiles.value.has(f.path)) selectedFiles.value.delete(f.path);
  else selectedFiles.value.add(f.path);
  selectedFiles.value = new Set(selectedFiles.value); // trigger reactivity
}

async function stageSelected() {
  err.value = '';
  message.value = '';
  const files = Array.from(selectedFiles.value);
  try {
    await api.gitStage(repoPath.value, files.length ? files : null);
    selectedFiles.value = new Set();
    await refresh();
    message.value = t('git_staged');
  } catch (e) { err.value = e.message; }
}

async function unstageSelected() {
  err.value = '';
  message.value = '';
  const files = Array.from(selectedFiles.value);
  try {
    await api.gitUnstage(repoPath.value, files.length ? files : null);
    selectedFiles.value = new Set();
    await refresh();
    message.value = t('git_unstaged');
  } catch (e) { err.value = e.message; }
}

async function commit() {
  commitMsgErr.value = '';
  if (!commitMsg.value.trim()) { commitMsgErr.value = t('git_msg_required'); return; }
  try {
    const r = await api.gitCommit(repoPath.value, commitMsg.value.trim());
    commitMsg.value = '';
    message.value = r.output?.split('\n')[0] || t('git_committed');
    await refresh();
  } catch (e) { commitMsgErr.value = e.message; }
}

async function showDiff(f, staged) {
  diffLoading.value = true;
  diffFor.value = { file: f.path, staged };
  try {
    const r = await api.gitDiff(repoPath.value, f.path, staged);
    diff.value = r.diff || t('git_no_diff');
  } catch (e) {
    diff.value = `error: ${e.message}`;
  } finally { diffLoading.value = false; }
}

function fileStatusBadge(f) {
  if (f.untracked) return { label: '?', class: 'text-amber-500' };
  if (f.staged && f.worktree !== ' ') return { label: 'M+', class: 'text-blue-500' };
  if (f.staged) return { label: '+', class: 'text-emerald-500' };
  if (f.worktree === 'M') return { label: 'M', class: 'text-yellow-500' };
  if (f.worktree === 'D') return { label: 'D', class: 'text-destructive' };
  return { label: f.index + f.worktree, class: 'text-muted-foreground' };
}

watch(() => props.open, (v) => {
  if (v && repoPath.value && !data.value) refresh();
});

function close() { emit('update:open', false); }
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
      class="fixed top-0 bottom-0 ltr:right-0 rtl:left-0 w-full sm:w-[520px] md:w-[620px] z-50 bg-card border-s border-border flex flex-col shadow-2xl"
    >
      <header class="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <GitBranch class="h-4 w-4 text-primary" />
        <div class="text-sm font-medium flex-1">{{ t('git_title') }}</div>
        <span v-if="data?.branch" class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary" dir="ltr">
          {{ data.branch }}
        </span>
        <Button variant="ghost" size="icon" @click="refresh" :title="t('fs_refresh')">
          <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" />
        </Button>
        <Button variant="ghost" size="icon" @click="close" :title="t('close')">
          <X class="h-4 w-4" />
        </Button>
      </header>

      <div class="px-3 py-2 border-b border-border space-y-2">
        <div class="flex items-center gap-2">
          <Input
            v-model="repoPath"
            @keydown.enter="refresh"
            dir="ltr"
            :placeholder="t('git_path_placeholder')"
            class="text-xs font-mono"
          />
          <Button size="sm" @click="refresh" :disabled="loading || !repoPath">
            <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" />
            <RefreshCw v-else class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div v-if="err" class="px-3 py-2 text-xs text-destructive flex items-center gap-2">
        <AlertTriangle class="h-3.5 w-3.5" /> {{ err }}
      </div>

      <div v-if="data?.is_repo" class="flex-1 min-h-0 flex flex-col">
        <!-- Files -->
        <div class="border-b border-border">
          <div class="px-3 py-2 flex items-center gap-2">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">
              {{ t('git_files', { n: data.files.length }) }}
            </div>
            <Button size="sm" variant="outline" :disabled="!selectedFiles.size && !data.files.length" @click="stageSelected">
              <Plus class="h-3 w-3" /> {{ t('git_stage') }}
            </Button>
            <Button size="sm" variant="outline" :disabled="!selectedFiles.size && !data.files.length" @click="unstageSelected">
              <Minus class="h-3 w-3" /> {{ t('git_unstage') }}
            </Button>
          </div>
          <div class="max-h-44 overflow-y-auto scrollbar-thin">
            <button
              v-for="f in data.files"
              :key="f.path"
              class="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent transition text-xs text-start"
              :class="diffFor?.file === f.path && 'bg-primary/5'"
            >
              <span @click.stop="toggleFile(f)" class="shrink-0">
                <CheckSquare v-if="fileChecked(f)" class="h-3.5 w-3.5 text-primary" />
                <Square v-else class="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <span :class="['font-mono text-[10px] w-7 text-center', fileStatusBadge(f).class]" dir="ltr">
                {{ fileStatusBadge(f).label }}
              </span>
              <span class="flex-1 truncate font-mono" dir="ltr" @click="showDiff(f, f.staged)">{{ f.path }}</span>
            </button>
            <div v-if="data.files.length === 0" class="px-3 py-6 text-center text-xs text-muted-foreground">
              {{ t('git_clean') }}
            </div>
          </div>
        </div>

        <!-- Diff -->
        <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <div v-if="!diffFor" class="text-xs text-muted-foreground p-4 text-center">
            {{ t('git_select_file') }}
          </div>
          <div v-else class="p-3">
            <div class="flex items-center gap-1.5 mb-2 text-[11px] text-muted-foreground">
              <FileText class="h-3 w-3" />
              <span class="font-mono" dir="ltr">{{ diffFor.file }}</span>
              <span class="ms-auto" v-if="diffFor.staged">({{ t('git_staged_view') }})</span>
              <CopyButton :text="diff" size="xs" />
            </div>
            <pre v-if="diffLoading" class="text-xs text-muted-foreground">…</pre>
            <pre v-else class="text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed" dir="ltr">{{ diff }}</pre>
          </div>
        </div>

        <!-- Commit -->
        <div class="border-t border-border p-3 space-y-2 bg-card/60">
          <Input
            v-model="commitMsg"
            :placeholder="t('git_commit_msg')"
            @keydown.enter="commit"
          />
          <p v-if="commitMsgErr" class="text-[11px] text-destructive">{{ commitMsgErr }}</p>
          <p v-if="message" class="text-[11px] text-emerald-500">{{ message }}</p>
          <div class="flex items-center gap-2">
            <Button size="sm" :disabled="!commitMsg.trim()" @click="commit">
              <GitCommit class="h-3.5 w-3.5" /> {{ t('git_commit') }}
            </Button>
            <details class="text-[11px] text-muted-foreground">
              <summary class="cursor-pointer">{{ t('git_log') }}</summary>
              <div class="mt-2 max-h-32 overflow-y-auto font-mono space-y-0.5" dir="ltr">
                <div v-for="(l, i) in data.log" :key="i">{{ l }}</div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div v-else-if="!loading && !err" class="flex-1 flex items-center justify-center text-xs text-muted-foreground text-center p-6 leading-6">
        {{ t('git_pick_repo') }}
      </div>
    </aside>
  </Transition>
</template>
