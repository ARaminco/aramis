<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import {
  Server, Network, RefreshCw, X, Play, Plus, Pencil, Trash2, Loader2,
  Wifi, WifiOff, Terminal, Folder, FileText, ArrowUp, AlertTriangle, ChevronRight,
  CheckCircle2, XCircle, Save, Eye, Lock, KeyRound, ArrowRight, ArrowLeft, Globe,
} from 'lucide-vue-next';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Badge from '@/components/ui/Badge.vue';
import Dialog from '@/components/ui/Dialog.vue';
import CopyButton from '@/components/CopyButton.vue';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open']);
const { t, locale } = useI18n();

const tab = ref('ssh');     // 'ssh' | 'ftp'
const loading = ref(false);
const err = ref('');

// ----- SSH state ---------------------------------------------------------
const sshHosts = ref([]);
const expandedAlias = ref(null);
const sshCommandByHost = ref({});       // alias -> command string
const sshOutputByHost = ref({});        // alias -> { running, stdout, stderr, exit, abort, probe }
function getOutput(alias) {
  if (!sshOutputByHost.value[alias]) sshOutputByHost.value[alias] = { running: false, stdout: '', stderr: '', exit: null, abort: null, probe: null };
  return sshOutputByHost.value[alias];
}

async function loadSshHosts() {
  loading.value = true;
  err.value = '';
  try {
    const r = await api.sshHosts();
    sshHosts.value = r.hosts || [];
  } catch (e) { err.value = e.message; sshHosts.value = []; }
  finally { loading.value = false; }
}

async function probeHost(h) {
  const out = getOutput(h.alias);
  out.probe = { running: true };
  try {
    const r = await api.sshProbe(h.hostname, h.port);
    out.probe = { running: false, ok: r.ok, error: r.error };
  } catch (e) { out.probe = { running: false, ok: false, error: e.message }; }
}

function runSshCommand(h) {
  const out = getOutput(h.alias);
  const command = (sshCommandByHost.value[h.alias] || '').trim();
  if (!command || out.running) return;
  out.running = true;
  out.stdout = '';
  out.stderr = '';
  out.exit = null;
  out.abort = api.sshStream(h.alias, command, ({ event, data }) => {
    if (event === 'output') {
      if (data.stream === 'stderr') out.stderr += data.text;
      else out.stdout += data.text;
    } else if (event === 'result') {
      out.exit = data.exit_code;
    } else if (event === 'error') {
      out.stderr += `\n[error] ${data.message}\n`;
    } else if (event === 'done') {
      out.running = false;
      out.abort = null;
    }
  });
}
function stopSshCommand(h) {
  const out = getOutput(h.alias);
  if (out.abort) out.abort();
  out.running = false;
}

function toggleExpand(alias) {
  expandedAlias.value = expandedAlias.value === alias ? null : alias;
}

// ----- FTP state ---------------------------------------------------------
const ftpConnections = ref([]);
const ftpEditOpen = ref(false);
const ftpDraft = ref(null);    // { id?, label, protocol, host, port, username, password, initial_path, secure }
const ftpStatusById = ref({}); // id -> { running, ok, error }
const ftpBrowser = ref(null);  // { connection, path, entries, loading, err, file? }
const ftpFile = ref(null);     // currently-viewed file: { path, content, dirty, original, loading, err }

async function loadFtp() {
  loading.value = true; err.value = '';
  try { ftpConnections.value = (await api.ftpList()).connections || []; }
  catch (e) { err.value = e.message; }
  finally { loading.value = false; }
}

function startAddFtp() {
  ftpDraft.value = {
    label: '', protocol: 'ftp', host: '', port: 21,
    username: 'anonymous', password: '', initial_path: '', secure: false,
  };
  ftpEditOpen.value = true;
}
function startEditFtp(c) {
  ftpDraft.value = {
    id: c.id, label: c.label, protocol: c.protocol, host: c.host, port: c.port,
    username: c.username, password: '', initial_path: c.initial_path || '', secure: !!c.secure,
  };
  ftpEditOpen.value = true;
}
async function saveFtp() {
  if (!ftpDraft.value.label || !ftpDraft.value.host) return;
  try {
    if (ftpDraft.value.id) {
      const patch = { ...ftpDraft.value };
      if (!patch.password) delete patch.password; // keep existing if blank
      await api.ftpUpdate(ftpDraft.value.id, patch);
    } else {
      await api.ftpCreate(ftpDraft.value);
    }
    ftpEditOpen.value = false;
    await loadFtp();
  } catch (e) { err.value = e.message; }
}
async function deleteFtp(c) {
  if (!confirm(t('hosts_ftp_confirm_delete', { label: c.label }))) return;
  await api.ftpDelete(c.id);
  await loadFtp();
}
async function testFtp(c) {
  ftpStatusById.value[c.id] = { running: true };
  try {
    const r = await api.ftpTest(c.id);
    ftpStatusById.value[c.id] = { running: false, ok: r.ok, error: r.error, pwd: r.pwd };
  } catch (e) { ftpStatusById.value[c.id] = { running: false, ok: false, error: e.message }; }
}

async function openBrowser(c, startPath) {
  ftpBrowser.value = { connection: c, path: startPath ?? (c.initial_path || ''), entries: [], loading: true, err: '' };
  ftpFile.value = null;
  try {
    const r = await api.ftpListDir(c.id, ftpBrowser.value.path);
    ftpBrowser.value.entries = r.entries || [];
    ftpBrowser.value.path = r.path || ftpBrowser.value.path;
  } catch (e) {
    ftpBrowser.value.err = e.message;
  } finally { ftpBrowser.value.loading = false; }
}
async function ftpUp() {
  if (!ftpBrowser.value) return;
  const p = ftpBrowser.value.path;
  if (!p || p === '/' || p === '') return;
  const idx = p.lastIndexOf('/');
  const next = idx <= 0 ? '/' : p.slice(0, idx);
  await openBrowser(ftpBrowser.value.connection, next);
}
async function pickFtpEntry(e) {
  if (e.type === 'dir') {
    const joined = (ftpBrowser.value.path.replace(/\/$/, '') + '/' + e.name).replace(/^\/+/, '/');
    await openBrowser(ftpBrowser.value.connection, joined);
    return;
  }
  // file
  const fullPath = (ftpBrowser.value.path.replace(/\/$/, '') + '/' + e.name).replace(/^\/+/, '/');
  ftpFile.value = { path: fullPath, content: '', original: '', dirty: false, loading: true, err: '' };
  try {
    const r = await api.ftpRead(ftpBrowser.value.connection.id, fullPath);
    if (r.binary) { ftpFile.value.err = t('fs_binary_file'); ftpFile.value.content = ''; ftpFile.value.original = ''; }
    else { ftpFile.value.content = r.content || ''; ftpFile.value.original = ftpFile.value.content; }
    ftpFile.value.size = r.size;
    ftpFile.value.truncated = r.truncated;
  } catch (e) { ftpFile.value.err = e.message; }
  finally { ftpFile.value.loading = false; }
}
function onFtpFileInput() {
  if (ftpFile.value) ftpFile.value.dirty = ftpFile.value.content !== ftpFile.value.original;
}
async function saveFtpFile() {
  if (!ftpFile.value || !ftpFile.value.dirty) return;
  ftpFile.value.loading = true;
  try {
    await api.ftpWrite(ftpBrowser.value.connection.id, ftpFile.value.path, ftpFile.value.content);
    ftpFile.value.original = ftpFile.value.content;
    ftpFile.value.dirty = false;
  } catch (e) { ftpFile.value.err = e.message; }
  finally { ftpFile.value.loading = false; }
}
function closeFtpFile() {
  if (ftpFile.value?.dirty && !confirm(t('fs_unsaved_confirm'))) return;
  ftpFile.value = null;
}
function closeBrowser() { ftpBrowser.value = null; ftpFile.value = null; }

// ----- Lifecycle ---------------------------------------------------------

watch(() => props.open, async (v) => {
  if (!v) return;
  await Promise.all([loadSshHosts(), loadFtp()]);
});

watch(() => tab.value, (v) => {
  if (v === 'ssh' && sshHosts.value.length === 0) loadSshHosts();
  if (v === 'ftp' && ftpConnections.value.length === 0) loadFtp();
});

function refresh() {
  if (tab.value === 'ssh') loadSshHosts();
  else loadFtp();
}
function close() {
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
      class="fixed top-0 bottom-0 ltr:right-0 rtl:left-0 w-full sm:w-[520px] md:w-[640px] z-50 bg-card border-s border-border flex flex-col shadow-2xl"
    >
      <header class="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <Server class="h-4 w-4 text-primary" />
        <div class="text-sm font-medium flex-1">{{ t('hosts_title') }}</div>
        <Button variant="ghost" size="icon" @click="refresh" :title="t('fs_refresh')">
          <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" />
        </Button>
        <Button variant="ghost" size="icon" @click="close" :title="t('close')">
          <X class="h-4 w-4" />
        </Button>
      </header>

      <!-- Tabs -->
      <div class="px-3 py-2 flex items-center gap-1 border-b border-border">
        <button
          type="button"
          @click="tab = 'ssh'"
          :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition',
                    tab === 'ssh' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent']"
        >
          <Terminal class="h-3.5 w-3.5" /> SSH
          <Badge variant="outline" class="text-[10px] px-1.5 py-0">{{ sshHosts.length }}</Badge>
        </button>
        <button
          type="button"
          @click="tab = 'ftp'"
          :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition',
                    tab === 'ftp' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent']"
        >
          <Network class="h-3.5 w-3.5" /> FTP
          <Badge variant="outline" class="text-[10px] px-1.5 py-0">{{ ftpConnections.length }}</Badge>
        </button>
      </div>

      <div v-if="err" class="px-3 py-2 text-xs text-destructive flex items-center gap-2 border-b border-destructive/20">
        <AlertTriangle class="h-3.5 w-3.5" /> {{ err }}
      </div>

      <!-- SSH tab -->
      <div v-if="tab === 'ssh'" class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div v-if="!loading && sshHosts.length === 0" class="text-center p-10 text-xs text-muted-foreground leading-6">
          <Server class="h-6 w-6 mx-auto mb-2 opacity-40" />
          {{ t('hosts_ssh_empty') }}
        </div>
        <div v-for="h in sshHosts" :key="h.alias + ':' + (h.port || 22)" class="border-b border-border last:border-b-0">
          <button
            type="button"
            class="w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-accent/40 transition text-start"
            @click="toggleExpand(h.alias)"
          >
            <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Terminal class="h-4 w-4 text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate" dir="ltr">{{ h.alias }}</div>
              <div class="text-[11px] text-muted-foreground truncate font-mono" dir="ltr">
                {{ h.user ? h.user + '@' : '' }}{{ h.hostname }}<span v-if="h.port && h.port !== 22">:{{ h.port }}</span>
              </div>
            </div>
            <Badge v-if="h.source === 'config'" variant="outline" class="text-[9px]">~/.ssh/config</Badge>
            <Badge v-else variant="outline" class="text-[9px]">known_hosts</Badge>
            <ChevronRight class="h-3.5 w-3.5 text-muted-foreground transition" :class="expandedAlias === h.alias && 'rotate-90'" />
          </button>

          <Transition
            enter-active-class="transition duration-150"
            leave-active-class="transition duration-100"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <div v-if="expandedAlias === h.alias" class="px-3 pb-3 space-y-2 bg-background/30">
              <!-- Meta -->
              <div class="grid grid-cols-2 gap-1.5 text-[11px] font-mono" dir="ltr">
                <div class="text-muted-foreground">host: <span class="text-foreground">{{ h.hostname }}</span></div>
                <div class="text-muted-foreground">port: <span class="text-foreground">{{ h.port || 22 }}</span></div>
                <div v-if="h.user" class="text-muted-foreground">user: <span class="text-foreground">{{ h.user }}</span></div>
                <div v-if="h.identity_file" class="text-muted-foreground truncate" :title="h.identity_file">key: <span class="text-foreground">{{ h.identity_file.split('/').pop() }}</span></div>
              </div>

              <!-- Probe -->
              <div class="flex items-center gap-2">
                <Button size="sm" variant="outline" @click="probeHost(h)" :disabled="getOutput(h.alias).probe?.running">
                  <Loader2 v-if="getOutput(h.alias).probe?.running" class="h-3 w-3 animate-spin" />
                  <Wifi v-else class="h-3 w-3" />
                  {{ t('hosts_ssh_probe') }}
                </Button>
                <span v-if="getOutput(h.alias).probe && !getOutput(h.alias).probe.running"
                      :class="['text-[11px] flex items-center gap-1', getOutput(h.alias).probe.ok ? 'text-emerald-500' : 'text-destructive']">
                  <CheckCircle2 v-if="getOutput(h.alias).probe.ok" class="h-3 w-3" />
                  <XCircle v-else class="h-3 w-3" />
                  {{ getOutput(h.alias).probe.ok ? t('hosts_reachable') : t('hosts_unreachable') + ': ' + getOutput(h.alias).probe.error }}
                </span>
              </div>

              <!-- Run command -->
              <div class="space-y-1.5">
                <Label class="text-[10px] uppercase tracking-wider">{{ t('hosts_ssh_command') }}</Label>
                <div class="flex gap-1.5">
                  <Input
                    v-model="sshCommandByHost[h.alias]"
                    @keydown.enter="runSshCommand(h)"
                    dir="ltr"
                    :placeholder="t('hosts_ssh_command_ph')"
                    class="font-mono text-xs"
                    :disabled="getOutput(h.alias).running"
                  />
                  <Button v-if="!getOutput(h.alias).running" size="sm" @click="runSshCommand(h)" :disabled="!(sshCommandByHost[h.alias] || '').trim()">
                    <Play class="h-3 w-3" /> {{ t('hosts_run') }}
                  </Button>
                  <Button v-else size="sm" variant="destructive" @click="stopSshCommand(h)">
                    <X class="h-3 w-3" /> {{ t('stop') }}
                  </Button>
                </div>
              </div>

              <!-- Output -->
              <div v-if="getOutput(h.alias).stdout || getOutput(h.alias).stderr || getOutput(h.alias).running || getOutput(h.alias).exit != null"
                   class="rounded-md bg-black/85 text-[11.5px] font-mono overflow-hidden">
                <div class="px-3 py-1 flex items-center justify-between text-[10px] text-zinc-400 border-b border-white/5">
                  <div class="flex items-center gap-1.5">
                    <span class="h-2 w-2 rounded-full bg-red-500/80" />
                    <span class="h-2 w-2 rounded-full bg-amber-500/80" />
                    <span class="h-2 w-2 rounded-full bg-emerald-500/80" />
                    <span class="mx-2 truncate" dir="ltr">ssh {{ h.alias }}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span v-if="getOutput(h.alias).exit != null" dir="ltr">exit: {{ getOutput(h.alias).exit }}</span>
                    <Loader2 v-else-if="getOutput(h.alias).running" class="h-3 w-3 animate-spin text-amber-400" />
                    <CopyButton :text="(getOutput(h.alias).stdout || '') + (getOutput(h.alias).stderr ? '\n' + getOutput(h.alias).stderr : '')" size="xs" variant="inline" />
                  </div>
                </div>
                <div class="px-3 py-2 max-h-72 overflow-auto scrollbar-thin" dir="ltr">
                  <pre v-if="getOutput(h.alias).stdout" class="text-zinc-100 whitespace-pre-wrap break-words">{{ getOutput(h.alias).stdout }}</pre>
                  <pre v-if="getOutput(h.alias).stderr" class="text-red-300 whitespace-pre-wrap break-words">{{ getOutput(h.alias).stderr }}</pre>
                  <span v-if="getOutput(h.alias).running" class="inline-block h-3 w-1.5 bg-zinc-100 animate-pulse align-baseline" />
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>

      <!-- FTP tab -->
      <div v-else-if="tab === 'ftp'" class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div class="p-3 flex items-center justify-between gap-2">
          <p class="text-[11px] text-muted-foreground flex-1 leading-snug">{{ t('hosts_ftp_blurb') }}</p>
          <Button size="sm" @click="startAddFtp">
            <Plus class="h-3.5 w-3.5" /> {{ t('hosts_ftp_add') }}
          </Button>
        </div>
        <div v-if="!loading && ftpConnections.length === 0" class="text-center p-10 text-xs text-muted-foreground leading-6">
          <Network class="h-6 w-6 mx-auto mb-2 opacity-40" />
          {{ t('hosts_ftp_empty') }}
        </div>
        <div v-for="c in ftpConnections" :key="c.id" class="border-t border-border first:border-t-0 px-3 py-3 space-y-2">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Network class="h-4 w-4 text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-sm font-medium truncate" dir="auto">{{ c.label }}</span>
                <Badge v-if="c.protocol === 'ftps' || c.secure" variant="outline" class="text-[9px] inline-flex items-center gap-0.5">
                  <Lock class="h-2.5 w-2.5" /> FTPS
                </Badge>
              </div>
              <div class="text-[11px] text-muted-foreground truncate font-mono" dir="ltr">
                {{ c.protocol }}://{{ c.username }}@{{ c.host }}:{{ c.port }}{{ c.initial_path || '' }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant="outline" @click="testFtp(c)" :disabled="ftpStatusById[c.id]?.running">
              <Loader2 v-if="ftpStatusById[c.id]?.running" class="h-3 w-3 animate-spin" />
              <Wifi v-else class="h-3 w-3" />
              {{ t('hosts_test') }}
            </Button>
            <Button size="sm" variant="outline" @click="openBrowser(c)">
              <Folder class="h-3 w-3" /> {{ t('hosts_ftp_browse') }}
            </Button>
            <Button size="sm" variant="ghost" @click="startEditFtp(c)">
              <Pencil class="h-3 w-3" /> {{ t('rename') }}
            </Button>
            <Button size="sm" variant="ghost" class="text-destructive" @click="deleteFtp(c)">
              <Trash2 class="h-3 w-3" />
            </Button>
            <span v-if="ftpStatusById[c.id] && !ftpStatusById[c.id].running"
                  :class="['text-[11px] flex items-center gap-1 ms-auto', ftpStatusById[c.id].ok ? 'text-emerald-500' : 'text-destructive']">
              <CheckCircle2 v-if="ftpStatusById[c.id].ok" class="h-3 w-3" />
              <XCircle v-else class="h-3 w-3" />
              <span v-if="ftpStatusById[c.id].ok" dir="ltr">{{ t('hosts_reachable') }} ({{ ftpStatusById[c.id].pwd || '/' }})</span>
              <span v-else dir="ltr">{{ ftpStatusById[c.id].error }}</span>
            </span>
          </div>
        </div>
      </div>
    </aside>
  </Transition>

  <!-- FTP edit dialog -->
  <Dialog :open="ftpEditOpen" :title="ftpDraft?.id ? t('hosts_ftp_edit') : t('hosts_ftp_add')" @update:open="(v) => ftpEditOpen = v">
    <form v-if="ftpDraft" @submit.prevent="saveFtp" class="space-y-3">
      <div class="space-y-1.5">
        <Label>{{ t('hosts_ftp_label') }}</Label>
        <Input v-model="ftpDraft.label" :placeholder="t('hosts_ftp_label_ph')" autofocus />
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div class="space-y-1.5">
          <Label>{{ t('hosts_ftp_protocol') }}</Label>
          <Select v-model="ftpDraft.protocol">
            <option value="ftp">FTP</option>
            <option value="ftps">FTPS</option>
          </Select>
        </div>
        <div class="space-y-1.5 col-span-2">
          <Label>{{ t('hosts_ftp_host') }}</Label>
          <Input v-model="ftpDraft.host" dir="ltr" placeholder="ftp.example.com" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="space-y-1.5">
          <Label>{{ t('hosts_ftp_port') }}</Label>
          <Input v-model.number="ftpDraft.port" type="number" min="1" max="65535" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('hosts_ftp_user') }}</Label>
          <Input v-model="ftpDraft.username" dir="ltr" autocomplete="off" />
        </div>
      </div>
      <div class="space-y-1.5">
        <Label>{{ t('password') }}</Label>
        <Input v-model="ftpDraft.password" type="password" autocomplete="new-password"
               :placeholder="ftpDraft.id ? t('hosts_ftp_password_keep') : ''" />
      </div>
      <div class="space-y-1.5">
        <Label>{{ t('hosts_ftp_initial_path') }}</Label>
        <Input v-model="ftpDraft.initial_path" dir="ltr" placeholder="/" />
      </div>
      <div class="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" @click="ftpEditOpen = false">{{ t('cancel') }}</Button>
        <Button type="submit"><Save class="h-4 w-4" /> {{ t('save') }}</Button>
      </div>
    </form>
  </Dialog>

  <!-- FTP browser modal -->
  <div v-if="ftpBrowser" class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3" @click.self="closeBrowser">
    <div class="w-full max-w-3xl h-[80vh] rounded-xl border border-border bg-popover shadow-2xl overflow-hidden flex flex-col">
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <Folder class="h-4 w-4 text-primary" />
        <div class="text-sm font-medium flex-1 truncate" dir="ltr">{{ ftpBrowser.connection.label }}</div>
        <Button variant="ghost" size="icon" @click="ftpUp" :title="t('fs_up')"><ArrowUp class="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" @click="openBrowser(ftpBrowser.connection, ftpBrowser.path)" :title="t('fs_refresh')">
          <RefreshCw class="h-4 w-4" :class="ftpBrowser.loading && 'animate-spin'" />
        </Button>
        <Button variant="ghost" size="icon" @click="closeBrowser"><X class="h-4 w-4" /></Button>
      </div>
      <div class="px-3 py-1.5 border-b border-border bg-card/40">
        <code class="text-[11px] font-mono text-muted-foreground" dir="ltr">{{ ftpBrowser.path || '/' }}</code>
      </div>
      <div v-if="ftpBrowser.err" class="px-3 py-2 text-xs text-destructive flex items-center gap-1.5">
        <AlertTriangle class="h-3.5 w-3.5" /> {{ ftpBrowser.err }}
      </div>
      <div class="flex-1 min-h-0 flex">
        <!-- list -->
        <div class="w-[42%] border-e border-border overflow-y-auto scrollbar-thin">
          <div v-if="ftpBrowser.loading" class="p-4 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 class="h-3.5 w-3.5 animate-spin" /> {{ t('loading') }}
          </div>
          <button
            v-for="e in ftpBrowser.entries" :key="e.name"
            @click="pickFtpEntry(e)"
            class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-accent transition text-start truncate"
            :class="ftpFile?.path?.endsWith('/' + e.name) && 'bg-primary/10'"
          >
            <Folder v-if="e.type === 'dir'" class="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <FileText v-else class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span class="truncate flex-1" dir="ltr">{{ e.name }}</span>
            <span v-if="e.type === 'file' && e.size != null" class="text-[10px] text-muted-foreground tabular-nums">{{ e.size }}</span>
          </button>
          <div v-if="!ftpBrowser.loading && ftpBrowser.entries.length === 0" class="px-3 py-6 text-center text-xs text-muted-foreground">
            {{ t('fs_empty') }}
          </div>
        </div>
        <!-- file editor -->
        <div class="flex-1 min-w-0 flex flex-col">
          <div v-if="!ftpFile" class="flex-1 flex items-center justify-center text-xs text-muted-foreground p-6 text-center leading-6">
            {{ t('hosts_ftp_pick_file') }}
          </div>
          <div v-else class="flex flex-col flex-1 min-h-0">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
              <FileText class="h-3.5 w-3.5 text-primary shrink-0" />
              <div class="text-xs font-mono truncate flex-1" dir="ltr">{{ ftpFile.path }}</div>
              <span v-if="ftpFile.dirty" class="text-[10px] text-amber-500">●</span>
              <CopyButton :text="ftpFile.content" size="xs" />
              <Button variant="ghost" size="icon" @click="closeFtpFile"><X class="h-3.5 w-3.5" /></Button>
            </div>
            <div v-if="ftpFile.err" class="px-3 py-2 text-[11px] text-destructive flex items-center gap-1.5">
              <AlertTriangle class="h-3 w-3" /> {{ ftpFile.err }}
            </div>
            <textarea
              v-model="ftpFile.content"
              @input="onFtpFileInput"
              spellcheck="false"
              dir="ltr"
              class="flex-1 min-h-0 bg-background/40 font-mono text-[12px] p-3 outline-none resize-none scrollbar-thin"
              :placeholder="t('fs_empty_file')"
              :readonly="ftpFile.loading"
            />
            <div class="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
              <Loader2 v-if="ftpFile.loading" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <Button size="sm" :disabled="!ftpFile.dirty || ftpFile.loading" @click="saveFtpFile">
                <Save class="h-3.5 w-3.5" /> {{ t('save') }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
