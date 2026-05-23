<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Card from '@/components/ui/Card.vue';
import Select from '@/components/ui/Select.vue';
import Badge from '@/components/ui/Badge.vue';
import {
  ArrowLeft, ArrowRight, Loader2, RefreshCw, Save, KeyRound, Cpu, ServerCog, Globe, LogOut, Sun, Moon,
  Database, Brain, Download, Trash2, Plus,
  Activity, Play, Check, X as XIcon, CircleSlash, Minus, Type, ScrollText,
} from 'lucide-vue-next';
import { scale as uiScale, setScale, bumpScale, resetScale, SCALE_STEP } from '@/lib/ui-scale';

const router = useRouter();
const auth = useAuthStore();
const { t, locale, setLocale } = useI18n();

const cfg = ref({
  provider: 'openai',
  api_key: '',
  model: 'gpt-4.1-mini',
  base_url: '',
  temperature: 0.2,
  request_timeout_seconds: 120,
  command_approval: 'auto',
});
const saved = ref(null);
const loading = ref(false);
const message = ref('');

const sysInfo = ref(null);
const sysLoading = ref(false);

const currentPw = ref('');
const newPw = ref('');
const pwMsg = ref('');

const dark = ref(document.documentElement.classList.contains('dark'));
function toggleDark() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('aramis_theme', dark.value ? 'dark' : 'light');
}

const modelSuggestions = computed(() => {
  switch (cfg.value.provider) {
    case 'openai': return ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o4-mini'];
    case 'anthropic': return ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    case 'ollama': return ['llama3.1', 'qwen2.5-coder', 'mistral'];
    case 'groq': return ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'];
    case 'openrouter': return ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4', 'meta-llama/llama-3.3-70b-instruct'];
    case 'together': return ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'];
    default: return [];
  }
});

const baseUrlPlaceholder = computed(() => {
  switch (cfg.value.provider) {
    case 'openai_compatible': return t('ph_base_url_compat');
    case 'ollama': return t('ph_base_url_ollama');
    case 'openai': return t('ph_base_url_openai');
    case 'anthropic': return t('ph_base_url_anthropic');
    default: return t('ph_base_url_default');
  }
});

const apiKeyPlaceholder = computed(() =>
  cfg.value.provider === 'ollama' ? t('ph_api_key_ollama') : t('ph_api_key_openai')
);

// --- Diagnostics ---
const diagResult = ref(null);
const diagLoading = ref(false);
async function runDiag() {
  diagLoading.value = true;
  try {
    diagResult.value = await api.runDiagnostics();
  } catch (e) {
    diagResult.value = {
      results: [{ id: 'request', status: 'fail', error: e.message }],
      total: 1, passed: 0, failed: 1, skipped: 0, when: Date.now(),
    };
  } finally { diagLoading.value = false; }
}

// --- Data & memory ---
const stats = ref(null);
const memory = ref([]);
const memDraft = ref({ key: '', value: '', kind: 'note' });
const memMsg = ref('');

async function loadStats() {
  try { stats.value = (await api.getDataStats()).stats; } catch {}
}
async function loadMemory() {
  try { memory.value = (await api.listMemory()).entries; } catch {}
}
async function saveMemory() {
  memMsg.value = '';
  if (!memDraft.value.key.trim() || !memDraft.value.value.trim()) return;
  try {
    await api.upsertMemory({
      key: memDraft.value.key.trim(),
      value: memDraft.value.value.trim(),
      kind: memDraft.value.kind,
    });
    memDraft.value = { key: '', value: '', kind: 'note' };
    await loadMemory();
    await loadStats();
  } catch (e) { memMsg.value = `${t('error')}: ${e.message}`; }
}
async function deleteMemoryEntry(entry) {
  if (!confirm(t('confirm_delete_memory', { key: entry.key }))) return;
  await api.deleteMemory(entry.key);
  await loadMemory();
  await loadStats();
}
async function wipeAll() {
  if (!confirm(t('wipe_data_confirm'))) return;
  await api.wipeData();
  await loadStats();
  await loadMemory();
  alert(t('wipe_data_done'));
}
function exportDb() {
  window.location.href = api.exportDbUrl();
}

function formatBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function loadAll() {
  loading.value = true;
  try {
    const [{ config }, { info }] = await Promise.all([api.getAIConfig(), api.getSystemInfo()]);
    saved.value = config;
    if (config) cfg.value = { ...cfg.value, ...config };
    sysInfo.value = info;
    await Promise.all([loadStats(), loadMemory()]);
  } finally { loading.value = false; }
}
onMounted(loadAll);

async function save() {
  message.value = '';
  loading.value = true;
  try {
    const payload = { ...cfg.value };
    if (payload.api_key && payload.api_key.startsWith('••••')) delete payload.api_key;
    const { config } = await api.setAIConfig(payload);
    saved.value = config;
    message.value = t('ai_saved');
  } catch (e) {
    message.value = `${t('error')}: ${e.message}`;
  } finally { loading.value = false; }
}

async function redetect() {
  sysLoading.value = true;
  try { const { info } = await api.redetectSystem(); sysInfo.value = info; }
  finally { sysLoading.value = false; }
}

async function changePw() {
  pwMsg.value = '';
  if (newPw.value.length < 6) { pwMsg.value = t('err_password_new_short'); return; }
  try {
    await api.changePassword(currentPw.value, newPw.value);
    pwMsg.value = t('password_changed');
    currentPw.value = ''; newPw.value = '';
  } catch (e) { pwMsg.value = `${t('error')}: ${e.message}`; }
}

function logout() { auth.logout(); router.replace('/login'); }
function goChat() { router.push('/chat'); }
function goChangelog() { router.push('/changelog'); }
</script>

<template>
  <div class="min-h-[100dvh] bg-background text-foreground">
    <header class="main-header sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" @click="goChat" :title="t('go_to_chat')">
          <ArrowRight v-if="locale === 'fa'" class="h-5 w-5" />
          <ArrowLeft v-else class="h-5 w-5" />
        </Button>
        <h1 class="text-base font-semibold flex-1">{{ t('settings') }}</h1>
        <Button variant="ghost" size="icon" @click="toggleDark">
          <Sun v-if="dark" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click="logout" :title="t('logout')">
          <LogOut class="h-4 w-4" />
        </Button>
      </div>
    </header>

    <div class="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <!-- Language & theme -->
      <Card class="p-4 sm:p-5 space-y-4">
        <div class="flex items-center gap-2">
          <Globe class="h-4 w-4 text-muted-foreground" />
          <h2 class="font-medium">{{ t('language') }}</h2>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            :class="[
              'rounded-lg border px-4 py-3 text-sm transition flex items-center justify-between',
              locale === 'fa' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
            ]"
            @click="setLocale('fa')"
          >
            <span>فارسی</span>
            <span v-if="locale === 'fa'" class="text-[10px] text-primary font-medium">✓</span>
          </button>
          <button
            :class="[
              'rounded-lg border px-4 py-3 text-sm transition flex items-center justify-between',
              locale === 'en' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
            ]"
            @click="setLocale('en')"
          >
            <span>English</span>
            <span v-if="locale === 'en'" class="text-[10px] text-primary font-medium">✓</span>
          </button>
        </div>

        <div class="pt-3 border-t border-border">
          <div class="flex items-center gap-2 mb-2">
            <Type class="h-4 w-4 text-muted-foreground" />
            <h3 class="text-sm font-medium">{{ t('ui_scale') }}</h3>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" @click="bumpScale(-SCALE_STEP)" :title="t('smaller')">
              <Minus class="h-3.5 w-3.5" />
            </Button>
            <div class="flex-1 text-center text-sm font-mono tabular-nums" dir="ltr">
              {{ Math.round(uiScale * 100) }}%
            </div>
            <Button variant="outline" size="sm" @click="bumpScale(SCALE_STEP)" :title="t('larger')">
              <Plus class="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" @click="resetScale" :title="t('reset')">
              {{ t('reset') }}
            </Button>
          </div>
          <p class="text-[10px] text-muted-foreground mt-2 leading-5">{{ t('ui_scale_hint') }}</p>
        </div>
      </Card>

      <!-- AI -->
      <Card class="p-4 sm:p-5 space-y-4">
        <div class="flex items-center gap-2">
          <Cpu class="h-4 w-4 text-muted-foreground" />
          <h2 class="font-medium">{{ t('ai_section') }}</h2>
          <Badge v-if="saved && saved.model" variant="success">{{ t('ai_configured') }}</Badge>
          <Badge v-else variant="destructive">{{ t('ai_not_configured') }}</Badge>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          <div class="space-y-1.5">
            <Label>{{ t('provider') }}</Label>
            <Select v-model="cfg.provider">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="ollama">Ollama</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
              <option value="together">Together AI</option>
              <option value="openai_compatible">OpenAI-compatible</option>
            </Select>
          </div>

          <div class="space-y-1.5">
            <Label>{{ t('model') }}</Label>
            <Input v-model="cfg.model" list="model-suggestions" :placeholder="t('ph_model')" />
            <datalist id="model-suggestions">
              <option v-for="m in modelSuggestions" :key="m" :value="m" />
            </datalist>
          </div>

          <div class="space-y-1.5 md:col-span-2">
            <Label>{{ t('api_key') }}</Label>
            <Input v-model="cfg.api_key" type="password" :placeholder="apiKeyPlaceholder" autocomplete="off" />
          </div>

          <div class="space-y-1.5 md:col-span-2">
            <Label>{{ t('base_url_optional') }}</Label>
            <Input v-model="cfg.base_url" :placeholder="baseUrlPlaceholder" autocomplete="off" dir="ltr" />
          </div>

          <div class="space-y-1.5">
            <Label>{{ t('temperature') }}</Label>
            <Input v-model.number="cfg.temperature" type="number" step="0.1" min="0" max="2" />
          </div>

          <div class="space-y-1.5">
            <Label>{{ t('request_timeout') }}</Label>
            <Input v-model.number="cfg.request_timeout_seconds" type="number" step="10" min="10" max="600" />
            <p class="text-[10px] text-muted-foreground leading-5">{{ t('request_timeout_hint') }}</p>
          </div>

          <div class="space-y-2 md:col-span-2">
            <Label>{{ t('command_approval') }}</Label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                :class="[
                  'rounded-lg border px-3 py-2.5 text-sm text-start transition flex items-start gap-2',
                  cfg.command_approval === 'auto' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                ]"
                @click="cfg.command_approval = 'auto'"
              >
                <span class="text-base">⚡</span>
                <span class="flex-1">{{ t('command_approval_auto') }}</span>
                <span v-if="cfg.command_approval === 'auto'" class="text-primary text-xs">✓</span>
              </button>
              <button
                type="button"
                :class="[
                  'rounded-lg border px-3 py-2.5 text-sm text-start transition flex items-start gap-2',
                  cfg.command_approval === 'manual' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                ]"
                @click="cfg.command_approval = 'manual'"
              >
                <span class="text-base">🛡️</span>
                <span class="flex-1">{{ t('command_approval_manual') }}</span>
                <span v-if="cfg.command_approval === 'manual'" class="text-primary text-xs">✓</span>
              </button>
            </div>
            <p class="text-[10px] text-muted-foreground leading-5">{{ t('command_approval_hint') }}</p>
          </div>
        </div>

        <p v-if="message" class="text-sm" :class="message.startsWith(t('error')) ? 'text-destructive' : 'text-emerald-500'">
          {{ message }}
        </p>

        <div class="flex justify-end pt-1">
          <Button :disabled="loading" @click="save">
            <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
            <Save v-else class="h-4 w-4" />
            {{ t('save') }}
          </Button>
        </div>
      </Card>

      <!-- Diagnostics -->
      <Card class="p-4 sm:p-5 space-y-4">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <Activity class="h-4 w-4 text-muted-foreground" />
            <h2 class="font-medium">{{ t('diagnostics_section') }}</h2>
            <Badge
              v-if="diagResult"
              :variant="diagResult.failed > 0 ? 'destructive' : 'success'"
              class="text-[10px]"
            >
              {{ t('diag_summary', diagResult) }}
            </Badge>
          </div>
          <Button size="sm" :disabled="diagLoading" @click="runDiag">
            <Loader2 v-if="diagLoading" class="h-4 w-4 animate-spin" />
            <Play v-else class="h-4 w-4" />
            {{ diagLoading ? t('diag_running') : t('run_tests') }}
          </Button>
        </div>

        <ul v-if="diagResult" class="space-y-1.5">
          <li
            v-for="r in diagResult.results"
            :key="r.id"
            class="flex items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors"
            :class="[
              r.status === 'pass' && 'border-emerald-500/20 bg-emerald-500/5',
              r.status === 'fail' && 'border-destructive/30 bg-destructive/5',
              r.status === 'skip' && 'border-border bg-muted/20',
            ]"
          >
            <div class="mt-0.5 shrink-0">
              <Check v-if="r.status === 'pass'" class="h-4 w-4 text-emerald-500" />
              <XIcon v-else-if="r.status === 'fail'" class="h-4 w-4 text-destructive" />
              <CircleSlash v-else class="h-4 w-4 text-muted-foreground" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium">{{ t(`diag_${r.id}`) || r.id }}</span>
                <span v-if="r.latency_ms != null" class="text-[10px] text-muted-foreground font-mono" dir="ltr">
                  {{ r.latency_ms }}ms
                </span>
              </div>
              <div v-if="r.details" class="text-xs text-muted-foreground truncate mt-0.5" dir="ltr">{{ r.details }}</div>
              <div v-if="r.error" class="text-xs text-destructive break-words leading-5 mt-0.5">{{ r.error }}</div>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">{{ t('diag_hint') }}</p>
      </Card>

      <!-- System info -->
      <Card class="p-4 sm:p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <ServerCog class="h-4 w-4 text-muted-foreground" />
            <h2 class="font-medium">{{ t('system_section') }}</h2>
          </div>
          <Button variant="outline" size="sm" :disabled="sysLoading" @click="redetect">
            <Loader2 v-if="sysLoading" class="h-4 w-4 animate-spin" />
            <RefreshCw v-else class="h-4 w-4" />
            <span class="hidden sm:inline">{{ t('redetect') }}</span>
          </Button>
        </div>
        <pre v-if="sysInfo" class="text-[11px] sm:text-xs bg-muted/40 rounded-md p-3 overflow-auto max-h-80 scrollbar-thin" dir="ltr">{{ JSON.stringify(sysInfo, null, 2) }}</pre>
        <p v-else class="text-sm text-muted-foreground">{{ t('loading') }}</p>
      </Card>

      <!-- Data & memory -->
      <Card class="p-4 sm:p-5 space-y-4">
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4 text-muted-foreground" />
          <h2 class="font-medium">{{ t('data_section') }}</h2>
        </div>

        <div v-if="stats" class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div class="rounded-lg border border-border bg-muted/20 p-3">
            <div class="text-xl font-semibold">{{ stats.chats }}</div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{{ t('stat_chats') }}</div>
          </div>
          <div class="rounded-lg border border-border bg-muted/20 p-3">
            <div class="text-xl font-semibold">{{ stats.messages }}</div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{{ t('stat_messages') }}</div>
          </div>
          <div class="rounded-lg border border-border bg-muted/20 p-3">
            <div class="text-xl font-semibold">{{ stats.memory }}</div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{{ t('stat_memory') }}</div>
          </div>
          <div class="rounded-lg border border-border bg-muted/20 p-3">
            <div class="text-xl font-semibold">{{ formatBytes(stats.db_size_bytes) }}</div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{{ t('db_size') }}</div>
          </div>
        </div>

        <div v-if="stats" class="text-[11px] text-muted-foreground font-mono break-all" dir="ltr">
          {{ t('db_path') }}: {{ stats.db_path }}
        </div>

        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" @click="exportDb">
            <Download class="h-4 w-4" /> {{ t('export_db') }}
          </Button>
          <Button variant="outline" size="sm" class="text-destructive hover:bg-destructive/10" @click="wipeAll">
            <Trash2 class="h-4 w-4" /> {{ t('wipe_data') }}
          </Button>
        </div>
      </Card>

      <!-- Memory -->
      <Card class="p-4 sm:p-5 space-y-4">
        <div class="flex items-center gap-2">
          <Brain class="h-4 w-4 text-muted-foreground" />
          <h2 class="font-medium">{{ t('memory_section') }}</h2>
          <span class="text-xs text-muted-foreground">({{ memory.length }})</span>
        </div>

        <div v-if="memory.length === 0" class="text-sm text-muted-foreground py-3">
          {{ t('memory_empty') }}
        </div>

        <ul v-else class="space-y-2">
          <li v-for="m in memory" :key="m.key" class="rounded-lg border border-border bg-muted/10 p-3 space-y-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" class="text-[10px]">{{ t(`kind_${m.kind}`) || m.kind }}</Badge>
              <code class="text-xs font-mono text-foreground/80" dir="ltr">{{ m.key }}</code>
              <span class="text-[10px] text-muted-foreground ms-auto">{{ new Date(m.updated_at).toLocaleString() }}</span>
              <button class="p-1 rounded hover:bg-background text-destructive" @click="deleteMemoryEntry(m)" :title="t('delete')">
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
            <div class="text-sm whitespace-pre-wrap leading-6">{{ m.value }}</div>
          </li>
        </ul>

        <details>
          <summary class="cursor-pointer text-xs text-muted-foreground select-none">{{ t('add_memory') }}</summary>
          <div class="mt-3 space-y-2">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input v-model="memDraft.key" :placeholder="t('memory_key')" dir="ltr" />
              <Select v-model="memDraft.kind">
                <option value="preference">{{ t('kind_preference') }}</option>
                <option value="fact">{{ t('kind_fact') }}</option>
                <option value="env">{{ t('kind_env') }}</option>
                <option value="note">{{ t('kind_note') }}</option>
                <option value="secret">{{ t('kind_secret') }}</option>
              </Select>
              <Button size="sm" @click="saveMemory">
                <Plus class="h-4 w-4" /> {{ t('save') }}
              </Button>
            </div>
            <textarea
              v-model="memDraft.value"
              :placeholder="t('memory_value')"
              rows="2"
              class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p v-if="memMsg" class="text-xs text-destructive">{{ memMsg }}</p>
          </div>
        </details>
      </Card>

      <!-- Changelog & Version -->
      <Card class="p-4 sm:p-5 space-y-3 cursor-pointer hover:bg-accent/40 transition" @click="goChangelog">
        <div class="flex items-center gap-2">
          <ScrollText class="h-4 w-4 text-muted-foreground" />
          <h2 class="font-medium flex-1">{{ t('changelog_title') }}</h2>
          <ArrowRight v-if="locale === 'fa'" class="h-4 w-4 text-muted-foreground rotate-180" />
          <ArrowLeft v-else class="h-4 w-4 text-muted-foreground" />
        </div>
        <p class="text-xs text-muted-foreground leading-relaxed">{{ t('changelog_settings_blurb') }}</p>
      </Card>

      <!-- Password -->
      <Card class="p-4 sm:p-5 space-y-3">
        <div class="flex items-center gap-2">
          <KeyRound class="h-4 w-4 text-muted-foreground" />
          <h2 class="font-medium">{{ t('change_password') }}</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          <div class="space-y-1.5">
            <Label>{{ t('current_password') }}</Label>
            <Input v-model="currentPw" type="password" />
          </div>
          <div class="space-y-1.5">
            <Label>{{ t('new_password') }}</Label>
            <Input v-model="newPw" type="password" />
          </div>
        </div>
        <p v-if="pwMsg" class="text-sm" :class="pwMsg.startsWith(t('error')) ? 'text-destructive' : 'text-emerald-500'">{{ pwMsg }}</p>
        <div class="flex justify-end">
          <Button variant="outline" @click="changePw">{{ t('change_password') }}</Button>
        </div>
      </Card>
    </div>
  </div>
</template>
