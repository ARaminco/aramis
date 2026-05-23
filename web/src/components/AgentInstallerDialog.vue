<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import {
  Bot, Cpu, Sparkles, Download, Trash2, Check, X, Loader2, AlertTriangle,
  Settings, Eye, EyeOff, Save, ExternalLink, RefreshCw, Wrench, KeyRound, Cog,
  Terminal, Zap, Copy, LogIn,
} from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useChatStore } from '@/stores/chat';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Badge from '@/components/ui/Badge.vue';
import Dialog from '@/components/ui/Dialog.vue';
import CopyButton from '@/components/CopyButton.vue';

const props = defineProps({
  open: Boolean,
  initialTool: { type: String, default: 'claude' },     // 'claude' | 'codex' | 'gemini'
  initialTab: { type: String, default: 'overview' },     // 'overview' | 'install' | 'configure'
});
const emit = defineEmits(['update:open', 'changed']);
const { t } = useI18n();
const store = useChatStore();

const tool = ref(props.initialTool);
const tab = ref(props.initialTab);

const detected = ref(null);              // list of { id, installed, version, path } from cli/detect
const installOptions = ref(null);        // { options: [{id, name, available, kind}] }
const installManager = ref('');          // chosen package manager
const installRunning = ref(false);
const installAbort = ref(null);
const installLog = ref([]);              // [{ stream: 'stdout'|'stderr', text }]
const installComplete = ref(null);       // { ok, exit_code }

const cfg = ref(null);                   // current config from server
const cfgDraft = ref({ api_key: '', model: '', base_url: '', extra_args: '' });
const cfgLoading = ref(false);
const cfgMsg = ref('');
const showApiKey = ref(false);

const bootstrap = ref(null);             // OS-aware suggestions when nothing is on PATH
const bootstrapLoading = ref(false);
const bootstrapMsg = ref('');

const TOOLS = [
  { id: 'claude', icon: Bot,      label: 'Claude Code',   blurb: 'mode_claude_sub' },
  { id: 'codex',  icon: Cpu,      label: 'OpenAI Codex',  blurb: 'mode_codex_sub' },
  { id: 'gemini', icon: Sparkles, label: 'Gemini CLI',    blurb: 'agent_gemini_sub' },
];

const installedTool = computed(() => {
  if (!detected.value) return null;
  return detected.value.find((d) => d.id === tool.value) || null;
});
const isInstalled = computed(() => !!installedTool.value?.installed);

const logRef = ref(null);
async function scrollLogToBottom() {
  await nextTick();
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
}

async function loadAll() {
  // Detect installed CLIs
  try { const r = await api.detectCLIs(); detected.value = r.tools || []; }
  catch { detected.value = []; }
  // Install options for the current tool
  try {
    const r = await api.cliInstallOptions(tool.value);
    installOptions.value = r;
    // Only auto-select managers that are actually on PATH. If none are
    // detected, leave installManager empty so the Install button stays
    // disabled and the user sees what's missing.
    const firstAvailable = (r.options || []).find((o) => o.available);
    installManager.value = firstAvailable?.id || '';
  } catch { installOptions.value = null; }
  // Saved config
  await loadConfig();
  // Bootstrap suggestions (loaded lazily — only consumed by the bootstrap UI)
  if (!bootstrap.value) {
    try { bootstrap.value = await api.cliBootstrap(); }
    catch { bootstrap.value = null; }
  }
}

async function runBootstrap(rec) {
  if (!rec?.command) return;
  bootstrapMsg.value = '';
  bootstrapLoading.value = true;
  try {
    const r = await api.cliOpenTerminal(rec.command);
    if (!r.ok) { bootstrapMsg.value = r.error || 'failed to open terminal'; return; }
    bootstrapMsg.value = `Opened ${r.terminal || 'terminal'}. Run the command there, then click Re-scan below.`;
  } catch (e) { bootstrapMsg.value = e.message; }
  finally { bootstrapLoading.value = false; }
}

async function rescanPath() {
  bootstrapLoading.value = true;
  try {
    await api.cliRefreshPath();
    // Reload everything — detection, install options, bootstrap state
    bootstrap.value = null;
    await loadAll();
    emit('changed');
    bootstrapMsg.value = '';
  } catch (e) { bootstrapMsg.value = e.message; }
  finally { bootstrapLoading.value = false; }
}

const loginMsg = ref('');
const loginLoading = ref(false);
async function runLogin() {
  loginMsg.value = '';
  loginLoading.value = true;
  try {
    const cmd = `${tool.value} login`;
    const r = await api.cliOpenTerminal(cmd);
    if (!r.ok) { loginMsg.value = r.error || 'failed to open terminal'; return; }
    loginMsg.value = `Opened ${r.terminal || 'terminal'} — finish the login there, then come back.`;
  } catch (e) { loginMsg.value = e.message; }
  finally { loginLoading.value = false; }
}

const selectedManagerAvailable = computed(() => {
  if (!installManager.value || !installOptions.value) return false;
  return !!installOptions.value.options.find((o) => o.id === installManager.value)?.available;
});
const noManagersAvailable = computed(() => {
  if (!installOptions.value) return false;
  return !installOptions.value.options.some((o) => o.available);
});

async function loadConfig() {
  cfgMsg.value = '';
  cfgLoading.value = true;
  try {
    const r = await api.cliGetConfig(tool.value);
    cfg.value = r.config;
    cfgDraft.value = {
      api_key: '',
      model: r.config.model || '',
      base_url: r.config.base_url || '',
      extra_args: r.config.extra_args || '',
    };
  } catch (e) { cfgMsg.value = e.message; cfg.value = null; }
  finally { cfgLoading.value = false; }
}

async function saveConfig() {
  cfgMsg.value = '';
  cfgLoading.value = true;
  try {
    const payload = { ...cfgDraft.value };
    if (!payload.api_key) delete payload.api_key; // don't overwrite stored key with empty
    const r = await api.cliSetConfig(tool.value, payload);
    cfg.value = r.config;
    cfgDraft.value.api_key = '';
    cfgMsg.value = t('saved');
    emit('changed');
  } catch (e) { cfgMsg.value = e.message; }
  finally { cfgLoading.value = false; }
}

async function clearConfig() {
  if (!confirm(t('cli_cfg_clear_confirm'))) return;
  await api.cliClearConfig(tool.value);
  await loadConfig();
  emit('changed');
}

function appendLog(stream, text) {
  // Coalesce sequential same-stream chunks into one line entry for cleaner DOM.
  const last = installLog.value[installLog.value.length - 1];
  if (last && last.stream === stream) last.text += text;
  else installLog.value.push({ stream, text });
  scrollLogToBottom();
}

function startInstall(kind = 'install') {
  if (!installManager.value) return;
  installRunning.value = true;
  installComplete.value = null;
  installLog.value = [];
  const fn = kind === 'uninstall' ? api.cliUninstallStream : api.cliInstallStream;
  installAbort.value = fn(tool.value, installManager.value, ({ event, data }) => {
    switch (event) {
      case 'start':
        appendLog('stdout', `▶ ${data.kind || kind}: ${tool.value} via ${data.manager || installManager.value}\n`);
        break;
      case 'step_start':
        appendLog('stdout', `\n$ ${data.cmd} ${data.args.join(' ')}\n`);
        break;
      case 'output':
        appendLog(data.stream, data.text);
        break;
      case 'step_done':
        appendLog('stdout', `\n[step ${data.index + 1} → exit ${data.exit_code}]${data.killed ? ' killed' : ''}\n`);
        break;
      case 'complete':
        installComplete.value = data;
        appendLog(data.ok ? 'stdout' : 'stderr', data.ok ? `\n✓ ${kind} complete\n` : `\n✗ ${kind} failed (exit ${data.exit_code})\n`);
        break;
      case 'error':
        appendLog('stderr', `\n[error] ${data.message}\n`);
        break;
      case 'done':
        installRunning.value = false;
        installAbort.value = null;
        // Refresh detection after any install/uninstall
        api.detectCLIs().then((r) => { detected.value = r.tools || []; emit('changed'); }).catch(() => {});
        // Refresh chat store's detected CLIs too
        store.detectCLIs?.();
        break;
    }
  });
}

function cancelInstall() {
  if (installAbort.value) installAbort.value();
  installRunning.value = false;
}

// Sync state when (tool) or (open) changes
watch(() => [props.open, tool.value], async ([o]) => {
  if (!o) return;
  await loadAll();
}, { immediate: false });

watch(() => props.initialTool, (v) => { if (v) tool.value = v; });
watch(() => props.initialTab,  (v) => { if (v) tab.value = v; });
watch(() => props.open, (v) => { if (v) { tool.value = props.initialTool; tab.value = props.initialTab; } });
</script>

<template>
  <Dialog :open="open" :title="t('cli_manager_title')" @update:open="(v) => emit('update:open', v)" size="lg">
    <div class="space-y-3 -mt-1">
      <!-- Tool picker -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          v-for="x in TOOLS" :key="x.id"
          type="button"
          @click="tool = x.id; tab = 'overview'"
          :class="[
            'rounded-lg border p-3 text-start transition flex flex-col gap-1.5',
            tool === x.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
          ]"
        >
          <div class="flex items-center gap-2">
            <component :is="x.icon" class="h-4 w-4 text-primary shrink-0" />
            <span class="text-sm font-medium flex-1 min-w-0">{{ x.label }}</span>
          </div>
          <Badge
            v-if="detected"
            :variant="detected.find((d) => d.id === x.id)?.installed ? 'success' : 'outline'"
            class="text-[9px] px-1.5 py-0 whitespace-nowrap self-start"
          >
            {{ detected.find((d) => d.id === x.id)?.installed ? t('installed') : t('not_installed') }}
          </Badge>
          <div class="text-[11px] text-muted-foreground leading-snug">{{ t(x.blurb) }}</div>
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex items-center gap-1 border-b border-border">
        <button
          v-for="x in [
            { id: 'overview',  label: t('cli_tab_overview'),  icon: Wrench },
            { id: 'install',   label: isInstalled ? t('cli_tab_update') : t('cli_tab_install'), icon: Download },
            { id: 'configure', label: t('cli_tab_configure'), icon: Cog },
          ]" :key="x.id"
          type="button"
          @click="tab = x.id"
          :class="[
            'px-3 py-2 -mb-px text-xs flex items-center gap-1.5 border-b-2 transition',
            tab === x.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
          ]"
        >
          <component :is="x.icon" class="h-3.5 w-3.5" />
          {{ x.label }}
        </button>
        <span class="flex-1" />
        <Button variant="ghost" size="icon" @click="loadAll" :title="t('fs_refresh')">
          <RefreshCw class="h-3.5 w-3.5" />
        </Button>
      </div>

      <!-- OVERVIEW -->
      <div v-if="tab === 'overview'" class="space-y-3">
        <div class="rounded-lg border border-border bg-card/40 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <component :is="TOOLS.find((x) => x.id === tool).icon" class="h-4 w-4 text-primary" />
            <div class="text-sm font-medium">{{ TOOLS.find((x) => x.id === tool).label }}</div>
            <Badge
              :variant="isInstalled ? 'success' : 'outline'"
              class="text-[10px]"
            >
              {{ isInstalled ? t('installed') : t('not_installed') }}
            </Badge>
            <span class="flex-1" />
            <a
              v-if="installOptions?.homepage"
              :href="installOptions.homepage"
              target="_blank"
              rel="noopener"
              class="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
              dir="ltr"
            >
              {{ t('docs') }} <ExternalLink class="h-3 w-3" />
            </a>
          </div>
          <div v-if="isInstalled" class="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1" dir="ltr">
            <div class="text-muted-foreground">version: <span class="text-foreground">{{ installedTool.version || '?' }}</span></div>
            <div class="text-muted-foreground truncate" :title="installedTool.path">path: <span class="text-foreground">{{ installedTool.path }}</span></div>
          </div>
          <p v-else class="text-[11px] text-muted-foreground">{{ t('cli_overview_not_installed_hint') }}</p>
        </div>
        <!-- Config snapshot -->
        <div v-if="cfg" class="rounded-lg border border-border bg-card/40 p-3 space-y-1.5">
          <div class="flex items-center gap-2">
            <KeyRound class="h-3.5 w-3.5 text-muted-foreground" />
            <div class="text-xs font-medium">{{ t('cli_configuration') }}</div>
          </div>
          <div class="text-[11px] space-y-1" dir="ltr">
            <div>
              <span class="text-muted-foreground">API key: </span>
              <code v-if="cfg.api_key_set" class="text-foreground">{{ cfg.api_key_masked }}</code>
              <span v-else-if="cfg.inherits_from_ai_config" class="text-emerald-500">inherited from AI provider config ✓</span>
              <span v-else class="text-amber-500">not set</span>
            </div>
            <div v-if="cfg.model"><span class="text-muted-foreground">model: </span><code class="text-foreground">{{ cfg.model }}</code></div>
            <div v-if="cfg.base_url"><span class="text-muted-foreground">base_url: </span><code class="text-foreground">{{ cfg.base_url }}</code></div>
            <div v-if="cfg.extra_args"><span class="text-muted-foreground">extra args: </span><code class="text-foreground">{{ cfg.extra_args }}</code></div>
            <div class="text-muted-foreground">env var: <code class="text-foreground">{{ cfg.meta.key_env }}</code></div>
          </div>
        </div>
      </div>

      <!-- INSTALL / UPDATE / UNINSTALL -->
      <div v-else-if="tab === 'install'" class="space-y-3">
        <div v-if="!installOptions" class="text-xs text-muted-foreground">{{ t('loading') }}</div>
        <template v-else>
          <!-- Bootstrap card: appears only when no package manager is on PATH.
               One-click "Run in Terminal" — Aramis opens the user's native
               terminal app with the official install command pre-typed, so
               sudo prompts are handled correctly. -->
          <div
            v-if="noManagersAvailable && bootstrap"
            class="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-2.5"
          >
            <div class="flex items-start gap-2">
              <Zap class="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">{{ t('cli_bootstrap_title', { os: bootstrap.os_label }) }}</div>
                <p class="text-[11px] text-muted-foreground leading-snug mt-0.5">{{ t('cli_bootstrap_blurb') }}</p>
              </div>
            </div>
            <div class="space-y-2">
              <div
                v-for="rec in bootstrap.recommendations" :key="rec.id"
                class="rounded-md border border-border bg-card/40 p-2.5 space-y-1.5"
              >
                <div class="flex items-center gap-2">
                  <div class="text-xs font-medium flex-1 min-w-0">{{ rec.label }}</div>
                  <Badge v-if="rec.requires_sudo" variant="outline" class="text-[9px] whitespace-nowrap">{{ t('cli_bootstrap_sudo') }}</Badge>
                </div>
                <p v-if="rec.description" class="text-[11px] text-muted-foreground leading-snug">{{ rec.description }}</p>
                <div class="rounded bg-black/60 text-[11px] font-mono px-2 py-1.5 overflow-x-auto scrollbar-thin text-zinc-100" dir="ltr">
                  {{ rec.command }}
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <Button size="sm" :disabled="bootstrapLoading" @click="runBootstrap(rec)">
                    <Terminal class="h-3.5 w-3.5" /> {{ t('cli_bootstrap_run') }}
                  </Button>
                  <CopyButton :text="rec.command" size="sm" :label="t('copy')" variant="ghost" />
                  <a
                    v-if="rec.docs"
                    :href="rec.docs"
                    target="_blank"
                    rel="noopener"
                    class="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                    dir="ltr"
                  >
                    {{ t('docs') }} <ExternalLink class="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20">
              <p v-if="bootstrapMsg" class="text-[11px] text-amber-500 flex-1 leading-snug">{{ bootstrapMsg }}</p>
              <span v-else class="flex-1 text-[11px] text-muted-foreground">{{ t('cli_bootstrap_after_hint') }}</span>
              <Button size="sm" variant="outline" :disabled="bootstrapLoading" @click="rescanPath">
                <Loader2 v-if="bootstrapLoading" class="h-3 w-3 animate-spin" />
                <RefreshCw v-else class="h-3 w-3" /> {{ t('cli_bootstrap_rescan') }}
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            <Label>{{ t('cli_install_manager') }}</Label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <button
                v-for="opt in installOptions.options" :key="opt.id"
                type="button"
                :disabled="!opt.available || installRunning"
                @click="installManager = opt.id"
                :class="[
                  'rounded-md border p-2 text-start text-xs transition flex items-center gap-2 min-w-0',
                  installManager === opt.id && opt.available ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                  (!opt.available || installRunning) && 'opacity-50 cursor-not-allowed hover:bg-transparent',
                ]"
              >
                <Check v-if="installManager === opt.id && opt.available" class="h-3 w-3 text-primary shrink-0" />
                <span class="flex-1 truncate">{{ opt.name }}</span>
                <Badge v-if="!opt.available" variant="outline" class="text-[9px] whitespace-nowrap shrink-0">not on PATH</Badge>
              </button>
            </div>
            <p v-if="noManagersAvailable" class="text-[11px] text-amber-500 leading-snug flex items-start gap-1.5">
              <AlertTriangle class="h-3 w-3 mt-0.5 shrink-0" />
              {{ t('cli_install_no_manager') }}
            </p>
            <p v-else class="text-[10px] text-muted-foreground leading-snug">{{ t('cli_install_hint') }}</p>
          </div>

          <div class="flex items-center gap-2">
            <Button v-if="!installRunning" size="sm" :disabled="!selectedManagerAvailable" @click="startInstall('install')">
              <Download class="h-3.5 w-3.5" />
              {{ isInstalled ? t('cli_update') : t('cli_install') }}
            </Button>
            <Button v-else size="sm" variant="destructive" @click="cancelInstall">
              <X class="h-3.5 w-3.5" /> {{ t('stop') }}
            </Button>
            <Button v-if="isInstalled && !installRunning" size="sm" variant="ghost" class="text-destructive" @click="startInstall('uninstall')">
              <Trash2 class="h-3.5 w-3.5" /> {{ t('cli_uninstall') }}
            </Button>
            <Loader2 v-if="installRunning" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span class="flex-1" />
            <Badge v-if="installComplete && installComplete.ok" variant="success" class="text-[10px]">
              <Check class="h-2.5 w-2.5 inline" /> {{ t('cli_done') }}
            </Badge>
            <Badge v-else-if="installComplete && !installComplete.ok" variant="destructive" class="text-[10px]">
              <X class="h-2.5 w-2.5 inline" /> {{ t('cli_failed') }} (exit {{ installComplete.exit_code }})
            </Badge>
          </div>

          <!-- Install log -->
          <div
            v-if="installLog.length || installRunning"
            class="rounded-md bg-black/85 text-[11.5px] font-mono overflow-hidden"
          >
            <div class="px-3 py-1 flex items-center justify-between text-[10px] text-zinc-400 border-b border-white/5">
              <div class="flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full bg-red-500/80" />
                <span class="h-2 w-2 rounded-full bg-amber-500/80" />
                <span class="h-2 w-2 rounded-full bg-emerald-500/80" />
                <span class="mx-2 truncate" dir="ltr">{{ tool }} install</span>
              </div>
              <CopyButton :text="() => installLog.map((e) => e.text).join('')" size="xs" variant="inline" />
            </div>
            <div ref="logRef" class="px-3 py-2 max-h-72 overflow-auto scrollbar-thin" dir="ltr">
              <template v-for="(entry, idx) in installLog" :key="idx">
                <span :class="entry.stream === 'stderr' ? 'text-red-300' : 'text-zinc-100'" class="whitespace-pre-wrap break-words">{{ entry.text }}</span>
              </template>
              <span v-if="installRunning" class="inline-block h-3 w-1.5 bg-zinc-100 animate-pulse align-baseline" />
            </div>
          </div>
        </template>
      </div>

      <!-- CONFIGURE -->
      <div v-else-if="tab === 'configure'" class="space-y-3">
        <!-- Native login — the canonical way to authenticate the CLI. For
             tools like Claude Code this opens an OAuth flow in the browser
             that requires a TTY, so we hand it off to the user's terminal. -->
        <div v-if="isInstalled" class="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 space-y-2">
          <div class="flex items-start gap-2">
            <LogIn class="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{{ t('cli_login_title', { tool: TOOLS.find((x) => x.id === tool).label }) }}</div>
              <p class="text-[11px] text-muted-foreground leading-snug mt-0.5">{{ t('cli_login_blurb', { cmd: tool + ' login' }) }}</p>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" :disabled="loginLoading" @click="runLogin">
              <Loader2 v-if="loginLoading" class="h-3.5 w-3.5 animate-spin" />
              <Terminal v-else class="h-3.5 w-3.5" />
              {{ t('cli_login_run', { tool: tool }) }}
            </Button>
            <span v-if="loginMsg" class="text-[11px] text-muted-foreground flex-1">{{ loginMsg }}</span>
          </div>
        </div>
        <div v-else class="rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle class="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{{ t('cli_login_install_first') }}</span>
        </div>

        <div v-if="cfg?.inherits_from_ai_config && !cfg.api_key_set" class="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
          <Check class="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{{ t('cli_cfg_inherited') }}</span>
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('api_key') }} <span class="text-[10px] text-muted-foreground" dir="ltr">({{ cfg?.meta.key_env }})</span></Label>
          <div class="relative">
            <Input
              v-model="cfgDraft.api_key"
              :type="showApiKey ? 'text' : 'password'"
              autocomplete="off"
              :placeholder="cfg?.api_key_set ? cfg.api_key_masked + ' — ' + t('cli_cfg_keep_blank_to_keep') : (cfg?.inherits_from_ai_config ? t('cli_cfg_blank_uses_inherited') : 'sk-…')"
              class="pr-10"
              dir="ltr"
            />
            <button
              type="button"
              class="absolute top-1/2 -translate-y-1/2 ltr:right-2 rtl:left-2 text-muted-foreground hover:text-foreground"
              @click="showApiKey = !showApiKey"
            >
              <Eye v-if="showApiKey" class="h-3.5 w-3.5" />
              <EyeOff v-else class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1.5">
            <Label>{{ t('model') }}</Label>
            <Input v-model="cfgDraft.model" :placeholder="cfg?.meta.default_model || ''" dir="ltr" />
          </div>
          <div class="space-y-1.5">
            <Label>{{ t('base_url_optional') }}</Label>
            <Input v-model="cfgDraft.base_url" dir="ltr" :placeholder="t('cli_cfg_base_url_ph')" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('cli_cfg_extra_args') }}</Label>
          <Input v-model="cfgDraft.extra_args" dir="ltr" :placeholder="t('cli_cfg_extra_args_ph')" />
          <p class="text-[10px] text-muted-foreground leading-snug">{{ t('cli_cfg_extra_args_hint') }}</p>
        </div>

        <p v-if="cfgMsg" class="text-[11px]" :class="cfgMsg.toLowerCase().includes(t('error').toLowerCase()) ? 'text-destructive' : 'text-emerald-500'">{{ cfgMsg }}</p>

        <div class="flex items-center gap-2 pt-1">
          <Button :disabled="cfgLoading" @click="saveConfig">
            <Loader2 v-if="cfgLoading" class="h-3.5 w-3.5 animate-spin" />
            <Save v-else class="h-3.5 w-3.5" />
            {{ t('save') }}
          </Button>
          <Button v-if="cfg?.api_key_set || cfg?.model" variant="ghost" class="text-destructive" @click="clearConfig">
            <Trash2 class="h-3.5 w-3.5" /> {{ t('cli_cfg_clear') }}
          </Button>
        </div>
      </div>

      <div class="flex justify-end pt-1">
        <Button variant="outline" @click="emit('update:open', false)">{{ t('close') }}</Button>
      </div>
    </div>
  </Dialog>
</template>
