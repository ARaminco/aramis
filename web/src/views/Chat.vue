<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Label from '@/components/ui/Label.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Badge from '@/components/ui/Badge.vue';
import MessageContent from '@/components/MessageContent.vue';
import ToolCallCard from '@/components/ToolCallCard.vue';
import CopyButton from '@/components/CopyButton.vue';
import ModeSwitcher from '@/components/ModeSwitcher.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import FileExplorer from '@/components/FileExplorer.vue';
import GitPanel from '@/components/GitPanel.vue';
import SessionImporter from '@/components/SessionImporter.vue';
import HostsPanel from '@/components/HostsPanel.vue';
import AgentInstallerDialog from '@/components/AgentInstallerDialog.vue';
import {
  Plus, Send, Settings, Square, Trash2, Pencil, MessageSquare, Bot, User,
  Sparkles, AlertTriangle, Sun, Moon, LogOut, Menu, X as XIcon, Globe, Loader2, ArrowUp,
  Mic, MicOff, Pin, PinOff, Folder, GitBranch, Download, Search, Command as CommandIcon,
  Cpu, Server, Image as ImageIcon,
} from 'lucide-vue-next';
import { useVoiceInput } from '@/lib/voice';

const route = useRoute();
const router = useRouter();
const store = useChatStore();
const auth = useAuthStore();
const { t, locale, setLocale } = useI18n();

const input = ref('');
const askAnswer = ref('');
const scroller = ref(null);
const aiConfigured = ref(true);
const appVersion = ref('—');
const renameTarget = ref(null);
const renameTitle = ref('');
const sidebarOpen = ref(false);
const search = ref('');

const paletteOpen = ref(false);
const fileExplorerOpen = ref(false);
const gitPanelOpen = ref(false);
const importerOpen = ref(false);
const hostsPanelOpen = ref(false);
const installerOpen = ref(false);
const installerInitial = ref({ tool: 'claude', tab: 'overview' });

function openInstaller(payload = {}) {
  installerInitial.value = {
    tool: payload.tool || 'claude',
    tab: payload.tab || 'overview',
  };
  installerOpen.value = true;
}

const voice = useVoiceInput();
const voiceErrMsg = ref('');

function formatVoiceErr(code) {
  switch (code) {
    case 'unsupported': return t('voice_unsupported');
    case 'denied': return t('voice_denied');
    case 'too_short': return t('voice_too_short');
    default: return code || '';
  }
}

async function toggleVoice() {
  voiceErrMsg.value = '';
  if (voice.transcribing.value) return;
  if (voice.recording.value) {
    const text = await voice.stopAndTranscribe();
    if (text) {
      input.value = input.value ? `${input.value} ${text}`.trim() : text;
      autoResize();
    } else if (voice.error.value) {
      voiceErrMsg.value = formatVoiceErr(voice.error.value);
      if (voiceErrMsg.value === voice.error.value) {
        voiceErrMsg.value = t('voice_failed', { message: voice.error.value });
      }
    }
  } else {
    const ok = await voice.start();
    if (!ok) voiceErrMsg.value = formatVoiceErr(voice.error.value);
  }
}

function recDuration() {
  const s = voice.duration.value;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ---- Image attachment / paste -------------------------------------------
//
// The composer accepts pasted/dropped/picked images. Each upload returns a
// short URL (/uploads/<id>.<ext>) which we keep in `attachments` and inject
// as markdown image syntax into the outgoing message just before send. Users
// can remove a pending attachment via its preview chip.

const attachments = ref([]); // [{ url, preview, mime, size, uploading? }]
const imgInputRef = ref(null);
const imgErr = ref('');

function humanSize(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1024 / 1024).toFixed(2) + 'MB';
}

async function uploadImageFile(file) {
  imgErr.value = '';
  if (!file || !file.type?.startsWith('image/')) { imgErr.value = t('image_unsupported'); return; }
  if (file.size > 10 * 1024 * 1024) { imgErr.value = t('image_too_big', { size: humanSize(file.size) }); return; }
  // Local preview from the blob so the user sees it instantly.
  const preview = URL.createObjectURL(file);
  const placeholder = { preview, mime: file.type, size: file.size, uploading: true };
  attachments.value.push(placeholder);
  try {
    const r = await api.uploadImage(file);
    const idx = attachments.value.indexOf(placeholder);
    if (idx >= 0) attachments.value[idx] = { url: r.url, preview, mime: r.mime, size: r.size, uploading: false };
  } catch (e) {
    imgErr.value = e.message;
    attachments.value = attachments.value.filter((a) => a !== placeholder);
    URL.revokeObjectURL(preview);
  }
}

function onComposerPaste(e) {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type?.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { e.preventDefault(); uploadImageFile(f); }
    }
  }
}
function onComposerDrop(e) {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const hasImage = Array.from(files).some((f) => f.type?.startsWith('image/'));
  if (!hasImage) return;
  e.preventDefault();
  for (const f of files) { if (f.type?.startsWith('image/')) uploadImageFile(f); }
}
function pickImage() { imgInputRef.value?.click(); }
function onImagePicked(e) {
  const files = e.target?.files || [];
  for (const f of files) uploadImageFile(f);
  e.target.value = '';
}
function removeAttachment(a) {
  attachments.value = attachments.value.filter((x) => x !== a);
  try { URL.revokeObjectURL(a.preview); } catch {}
}

// Detect if a user-message body has markdown the renderer should process
// (images, code fences, links). Plain prose stays as plain text so users
// don't get surprised by accidental markdown interpretation.
function userHasMarkdown(text) {
  if (!text) return false;
  return /(!\[[^\]]*\]\([^)]+\)|```|`[^`]+`|^\s*[-*+]\s|\[[^\]]+\]\([^)]+\))/m.test(text);
}

const dark = ref(document.documentElement.classList.contains('dark'));
function toggleDark() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle('dark', dark.value);
  localStorage.setItem('aramis_theme', dark.value ? 'dark' : 'light');
}
function toggleLocale() {
  setLocale(locale.value === 'fa' ? 'en' : 'fa');
}

onMounted(async () => {
  await store.loadChats();
  store.detectCLIs(); // background — populates the mode switcher
  try { const { config } = await api.getAIConfig(); aiConfigured.value = !!(config && config.model); }
  catch { aiConfigured.value = false; }
  try { const cl = await api.getChangelog(); if (cl?.version) appVersion.value = cl.version; }
  catch { /* changelog endpoint may be unavailable; ignore */ }

  const id = route.params.id || store.chats[0]?.id;
  if (id) await openChat(id);
});

// Global keyboard shortcuts
function onGlobalKey(e) {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const meta = isMac ? e.metaKey : e.ctrlKey;
  if (!meta) return;
  // ⌘K — palette
  if (e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen.value = !paletteOpen.value; return; }
  // ⌘N — new chat
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); return; }
  // ⌘B — toggle sidebar
  if (e.key.toLowerCase() === 'b') { e.preventDefault(); sidebarOpen.value = !sidebarOpen.value; return; }
  // ⌘E — file explorer
  if (e.key.toLowerCase() === 'e') { e.preventDefault(); fileExplorerOpen.value = !fileExplorerOpen.value; return; }
  // ⌘G — git panel
  if (e.key.toLowerCase() === 'g') { e.preventDefault(); gitPanelOpen.value = !gitPanelOpen.value; return; }
  // ⌘H — hosts panel (SSH + FTP)
  if (e.key.toLowerCase() === 'h') { e.preventDefault(); hostsPanelOpen.value = !hostsPanelOpen.value; return; }
  // ⌘I — install / configure agent CLIs
  if (e.key.toLowerCase() === 'i') { e.preventDefault(); openInstaller({ tab: 'overview' }); return; }
  // ⌘/ — toggle theme
  if (e.key === '/') { e.preventDefault(); toggleDark(); return; }
}
onMounted(() => document.addEventListener('keydown', onGlobalKey));
onUnmounted(() => document.removeEventListener('keydown', onGlobalKey));

watch(() => route.params.id, async (id) => {
  if (id && id !== store.activeId) await openChat(id);
});

watch(() => [store.messages.length, store.streaming, store.phase], async () => {
  await nextTick();
  scrollToBottom();
}, { deep: true });

function scrollToBottom() {
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}

async function openChat(id) {
  await store.openChat(id);
  sidebarOpen.value = false;
  await nextTick();
  scrollToBottom();
}

async function newChat() {
  // Lazy: just clear the view. The actual chat row + title are created on
  // first message send (see chat store's sendMessage).
  store.clearActiveChat();
  router.replace({ name: 'chat' });
  sidebarOpen.value = false;
}

async function pickChat(id) {
  router.replace({ name: 'chat', params: { id } });
}

async function send() {
  const txt = input.value.trim();
  const ready = attachments.value.filter((a) => a.url && !a.uploading);
  if (!txt && ready.length === 0) return;
  if (store.streaming) return;
  // Refuse to send while uploads are in flight
  if (attachments.value.some((a) => a.uploading)) return;

  // Compose final message: text + a markdown image line per attachment.
  const imageLines = ready.map((a) => `![image](${a.url})`).join('\n');
  const finalText = [txt, imageLines].filter(Boolean).join('\n\n');

  input.value = '';
  // Revoke object URLs so the browser frees the blob.
  for (const a of attachments.value) { try { URL.revokeObjectURL(a.preview); } catch {} }
  attachments.value = [];
  autoResize();
  if (!store.activeId) {
    const id = await store.createChat();
    router.replace({ name: 'chat', params: { id } });
  }
  await store.sendMessage(finalText);
}

async function answerAsk() {
  const a = askAnswer.value;
  if (!a) return;
  askAnswer.value = '';
  await store.respondToAsk(a);
}

const composerRef = ref(null);
function autoResize() {
  const el = composerRef.value?.$el || composerRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}
function onComposerKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

function startRename(c) {
  renameTarget.value = c;
  renameTitle.value = c.title || '';
}
async function commitRename() {
  if (renameTarget.value && renameTitle.value.trim()) {
    await store.renameChat(renameTarget.value.id, renameTitle.value.trim());
  }
  renameTarget.value = null;
}
async function deleteChat(c) {
  if (!confirm(t('confirm_delete_chat', { title: c.title || t('new_chat') }))) return;
  await store.deleteChat(c.id);
  if (!store.activeId) router.replace({ name: 'chat' });
}

function logout() { auth.logout(); router.replace('/login'); }
function gotoSettings() { router.push('/settings'); }

const activeChatTitle = computed(() => {
  const c = store.chats.find((x) => x.id === store.activeId);
  return c?.title || t('new_chat');
});

const phaseLabel = computed(() => {
  const p = store.phase;
  if (!p) return '';
  if (p.phase === 'connecting') return t('phase_connecting');
  if (p.phase === 'thinking') return t('phase_thinking');
  if (p.phase === 'responding') return t('phase_responding');
  if (p.phase === 'tool_running') return t('phase_tool_running', { tool: t(`tool_${p.tool}`) || p.tool });
  return '';
});

const examples = computed(() => [t('example_disk'), t('example_nginx'), t('example_ports')]);

// Mode handling: chat-level overrides composer-level when one is active.
const currentMode = computed(() => store.activeMode || store.composerMode || 'aramis');
async function setMode(mode) {
  store.setComposerMode(mode);
  if (store.activeId && currentMode.value !== mode) {
    await store.setChatMode(store.activeId, mode);
  }
}
async function setCwd(cwd) {
  store.setComposerCwd(cwd);
  if (store.activeId) await store.setChatCwd(store.activeId, cwd);
}

// Filtered chat list
const filteredChats = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return store.chats;
  return store.chats.filter((c) =>
    (c.title || '').toLowerCase().includes(q) ||
    (c.first_user || '').toLowerCase().includes(q)
  );
});

const pinned = computed(() => filteredChats.value.filter((c) => c.pinned));
const recent = computed(() => filteredChats.value.filter((c) => !c.pinned));

const isCLIMode = computed(() => currentMode.value === 'claude' || currentMode.value === 'codex');

function modeBadge(mode) {
  if (mode === 'claude') return { label: 'Claude Code', class: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' };
  if (mode === 'codex')  return { label: 'Codex',       class: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
  return { label: 'Aramis', class: 'bg-primary/15 text-primary' };
}

function fmtCost(usd) {
  if (usd == null) return '';
  return '$' + Number(usd).toFixed(4);
}
</script>

<template>
  <div class="flex h-full overflow-hidden bg-background text-foreground">
    <!-- Sidebar (drawer on mobile, fixed on desktop) -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0" leave-to-class="opacity-0"
    >
      <div v-if="sidebarOpen" class="fixed inset-0 z-40 bg-black/40 md:hidden" @click="sidebarOpen = false" />
    </Transition>

    <aside
      class="fixed md:static inset-y-0 z-50 w-[80%] max-w-xs md:w-72 md:max-w-none shrink-0 border-s border-border flex flex-col bg-card transition-transform duration-200 ease-out rtl:right-0 ltr:left-0 md:!translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : 'rtl:translate-x-full ltr:-translate-x-full'"
    >
      <div class="sidebar-header p-3 flex items-center gap-2 border-b border-border">
        <div class="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <Bot class="h-4 w-4 text-primary" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold leading-tight">{{ t('app_name') }}</div>
          <div class="text-[10px] text-muted-foreground leading-tight">{{ t('app_tagline') }}</div>
        </div>
        <Button variant="ghost" size="icon" @click="toggleLocale" :title="t('language')">
          <Globe class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click="toggleDark">
          <Sun v-if="dark" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" class="md:hidden" @click="sidebarOpen = false">
          <XIcon class="h-4 w-4" />
        </Button>
      </div>

      <div class="px-3 pt-3 pb-2 space-y-2">
        <Button class="w-full" @click="newChat">
          <Plus class="h-4 w-4" /> {{ t('new_chat') }}
        </Button>
        <Button class="w-full" variant="outline" @click="paletteOpen = true">
          <Search class="h-3.5 w-3.5" />
          <span class="flex-1 text-start">{{ t('cmd_palette') }}</span>
          <span class="text-[10px] text-muted-foreground font-mono" dir="ltr">⌘K</span>
        </Button>
        <div class="grid grid-cols-4 gap-1.5">
          <Button variant="outline" size="sm" class="text-[11px]" @click="fileExplorerOpen = true" :title="t('cmd_open_files') + ' (⌘E)'">
            <Folder class="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" class="text-[11px]" @click="gitPanelOpen = true" :title="t('cmd_open_git') + ' (⌘G)'">
            <GitBranch class="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" class="text-[11px]" @click="hostsPanelOpen = true" :title="t('hosts_title') + ' (⌘H)'">
            <Server class="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" class="text-[11px]" @click="importerOpen = true" :title="t('import_sessions')">
            <Download class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <!-- Search -->
      <div class="px-3 pb-2">
        <div class="relative">
          <Search class="absolute top-1/2 -translate-y-1/2 ltr:left-2.5 rtl:right-2.5 h-3 w-3 text-muted-foreground" />
          <input
            v-model="search"
            type="text"
            :placeholder="t('search_chats')"
            class="w-full rounded-md border border-input bg-transparent ltr:pl-7 rtl:pr-7 ltr:pr-2 rtl:pl-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        <div v-if="filteredChats.length === 0" class="text-xs text-muted-foreground p-4 text-center">
          {{ search ? t('search_no_results') : t('no_chats') }}
        </div>

        <!-- Pinned -->
        <template v-if="pinned.length">
          <div class="px-1.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Pin class="h-2.5 w-2.5" /> {{ t('pinned') }}
          </div>
          <button
            v-for="c in pinned" :key="c.id"
            @click="pickChat(c.id)"
            :class="[
              'group w-full text-start rounded-md px-2 py-1.5 my-px text-[13px] leading-tight transition flex items-center gap-2',
              store.activeId === c.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
            ]"
          >
            <Pin class="h-3 w-3 text-amber-500 shrink-0" />
            <span class="truncate flex-1 min-w-0" dir="auto">{{ c.title || t('new_chat') }}</span>
            <span v-if="c.mode && c.mode !== 'aramis'" :class="['text-[9px] font-medium px-1.5 py-0.5 rounded-full', modeBadge(c.mode).class]" dir="ltr">
              {{ c.mode }}
            </span>
            <span class="opacity-0 group-hover:opacity-100 md:flex gap-1 hidden">
              <span class="p-1 rounded hover:bg-background/60" @click.stop="store.togglePin(c.id)"><PinOff class="h-3.5 w-3.5" /></span>
              <span class="p-1 rounded hover:bg-background/60" @click.stop="startRename(c)"><Pencil class="h-3.5 w-3.5" /></span>
              <span class="p-1 rounded hover:bg-background/60" @click.stop="deleteChat(c)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></span>
            </span>
          </button>
        </template>

        <!-- Recent -->
        <template v-if="recent.length">
          <div v-if="pinned.length" class="px-1.5 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {{ t('chats') }}
          </div>
          <button
            v-for="c in recent" :key="c.id"
            @click="pickChat(c.id)"
            :class="[
              'group w-full text-start rounded-md px-2 py-1.5 my-px text-[13px] leading-tight transition flex items-center gap-2',
              store.activeId === c.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
            ]"
          >
            <MessageSquare class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span class="truncate flex-1 min-w-0" dir="auto">{{ c.title || t('new_chat') }}</span>
            <span v-if="c.mode && c.mode !== 'aramis'" :class="['text-[9px] font-medium px-1.5 py-0.5 rounded-full', modeBadge(c.mode).class]" dir="ltr">
              {{ c.mode }}
            </span>
            <span class="opacity-0 group-hover:opacity-100 md:flex gap-1 hidden">
              <span class="p-1 rounded hover:bg-background/60" @click.stop="store.togglePin(c.id)"><Pin class="h-3.5 w-3.5" /></span>
              <span class="p-1 rounded hover:bg-background/60" @click.stop="startRename(c)"><Pencil class="h-3.5 w-3.5" /></span>
              <span class="p-1 rounded hover:bg-background/60" @click.stop="deleteChat(c)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></span>
            </span>
          </button>
        </template>
      </div>

      <div class="border-t border-border p-2 flex items-center gap-1">
        <Button variant="ghost" size="sm" class="flex-1 justify-start" @click="gotoSettings">
          <Settings class="h-4 w-4" /> {{ t('settings') }}
        </Button>
        <Button variant="ghost" size="icon" @click="logout" :title="t('logout')">
          <LogOut class="h-4 w-4" />
        </Button>
      </div>
      <div class="border-t border-border flex items-center justify-between gap-2 px-2 py-1">
        <router-link
          to="/changelog"
          class="text-[10px] text-muted-foreground/80 hover:text-primary inline-flex items-center gap-1 font-mono px-2 py-1 rounded hover:bg-accent transition"
          dir="ltr"
          :title="t('changelog_title')"
        >
          v{{ appVersion }}
        </router-link>
        <a
          href="https://aramin.co"
          target="_blank"
          rel="noopener"
          class="text-[10px] text-muted-foreground/70 hover:text-foreground transition"
          dir="ltr"
        >
          aramin.co
        </a>
      </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 flex flex-col min-w-0 relative">
      <!-- Top bar -->
      <header class="main-header flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card/40 backdrop-blur-sm">
        <Button variant="ghost" size="icon" class="md:hidden" @click="sidebarOpen = true">
          <Menu class="h-5 w-5" />
        </Button>
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <div class="text-sm font-medium truncate" dir="auto">{{ activeChatTitle }}</div>
          <span v-if="store.activeId" :class="['hidden sm:inline-flex text-[9.5px] font-medium px-1.5 py-0.5 rounded-full', modeBadge(currentMode).class]" dir="ltr">
            {{ modeBadge(currentMode).label }}
          </span>
        </div>
        <Button variant="ghost" size="icon" class="hidden md:inline-flex" @click="paletteOpen = true" :title="t('cmd_palette') + ' (⌘K)'">
          <CommandIcon class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click="fileExplorerOpen = true" :title="t('cmd_open_files') + ' (⌘E)'">
          <Folder class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click="gitPanelOpen = true" :title="t('cmd_open_git') + ' (⌘G)'">
          <GitBranch class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click="hostsPanelOpen = true" :title="t('hosts_title') + ' (⌘H)'">
          <Server class="h-4 w-4" />
        </Button>
        <Button v-if="store.activeId" variant="ghost" size="icon" class="md:hidden" @click="newChat">
          <Plus class="h-5 w-5" />
        </Button>
      </header>

      <div v-if="!aiConfigured && currentMode === 'aramis'" class="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2 text-xs">
        <AlertTriangle class="h-4 w-4 text-amber-500 shrink-0" />
        <span class="flex-1">{{ t('ai_not_configured_banner') }}</span>
        <Button size="sm" variant="outline" @click="gotoSettings">{{ t('configure') }}</Button>
      </div>

      <!-- CLI session info bar -->
      <div v-if="isCLIMode && store.cliMeta" class="bg-card/40 border-b border-border px-4 py-1.5 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap" dir="ltr">
        <span v-if="store.cliMeta.session_id">session: <code class="font-mono">{{ store.cliMeta.session_id.slice(0,12) }}…</code></span>
        <span v-if="store.cliMeta.model">model: <code class="font-mono">{{ store.cliMeta.model }}</code></span>
        <span v-if="store.cliMeta.cwd">cwd: <code class="font-mono">{{ store.cliMeta.cwd }}</code></span>
        <span v-if="store.cliMeta.total_cost_usd != null">cost: <code class="font-mono">{{ fmtCost(store.cliMeta.total_cost_usd) }}</code></span>
        <span v-if="store.cliMeta.num_turns != null">turns: {{ store.cliMeta.num_turns }}</span>
        <CopyButton v-if="store.cliMeta.session_id" :text="store.cliMeta.session_id" size="xs" />
      </div>

      <div ref="scroller" class="flex-1 overflow-y-auto scrollbar-thin">
        <div class="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
          <!-- Empty state -->
          <div v-if="store.messages.length === 0" class="text-center py-12 sm:py-20 space-y-4">
            <div class="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles class="h-7 w-7 text-primary" />
            </div>
            <h2 class="text-lg sm:text-2xl font-semibold tracking-tight">{{ t('empty_heading') }}</h2>
            <p class="text-sm text-muted-foreground max-w-md mx-auto leading-7 px-2">
              {{ t('empty_subtext') }}
            </p>
            <div class="flex flex-wrap gap-2 justify-center text-xs pt-2 px-2">
              <button
                v-for="ex in examples" :key="ex"
                class="px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent text-foreground/80 hover:text-foreground transition"
                @click="input = ex"
              >
                {{ ex }}
              </button>
            </div>
          </div>

          <template v-for="(m, idx) in store.messages" :key="idx">
            <!-- User -->
            <div v-if="m.role === 'user'" class="group flex gap-2.5 justify-end animate-fade-in">
              <div class="flex flex-col items-end gap-1 max-w-[85%] sm:max-w-[80%]">
                <div
                  class="rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-3.5 py-2.5 text-sm leading-relaxed shadow-sm user-bubble"
                  dir="auto"
                >
                  <MessageContent v-if="userHasMarkdown(m.content)" :text="m.content" />
                  <span v-else class="whitespace-pre-wrap">{{ m.content }}</span>
                </div>
                <div class="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition flex items-center gap-1">
                  <CopyButton :text="m.content" size="xs" />
                </div>
              </div>
              <div class="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <User class="h-3.5 w-3.5" />
              </div>
            </div>

            <!-- Inline answer to ask_user -->
            <div v-else-if="m.role === 'ask_answer'" class="group flex gap-2.5 justify-end animate-fade-in">
              <div class="rounded-xl bg-amber-500/15 border border-amber-500/30 text-foreground px-3 py-2 max-w-[85%] text-sm">
                <div class="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-0.5 flex items-center justify-between gap-2">
                  <span>↩ {{ t('your_answer') }}</span>
                  <CopyButton :text="m.content" size="xs" class="opacity-0 group-hover:opacity-100 transition" />
                </div>
                <div class="font-mono" dir="ltr">{{ m.content }}</div>
              </div>
            </div>

            <!-- Assistant -->
            <div v-else-if="m.role === 'assistant'" class="group flex gap-2.5 animate-fade-in">
              <div class="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot class="h-3.5 w-3.5 text-primary" />
              </div>
              <div class="flex-1 space-y-2.5 min-w-0">
                <MessageContent v-if="m.content" :text="m.content" />
                <template v-if="m.tool_calls && m.tool_calls.length">
                  <ToolCallCard v-for="tc in m.tool_calls" :key="tc.id" :call="tc" />
                </template>
                <div v-if="m.error" class="text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle class="h-4 w-4" /> {{ m.error }}
                </div>
                <!-- Action row — icon-only, appears on hover -->
                <div v-if="(m.content || (m.tool_calls && m.tool_calls.length)) && !m._streaming" class="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition flex items-center gap-0.5">
                  <CopyButton :text="m.content || ''" size="xs" />
                </div>
                <!-- Live phase pill while this bubble is the active one -->
                <div
                  v-if="m._streaming && store.phase && phaseLabel"
                  class="inline-flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground"
                >
                  <Loader2 class="h-3 w-3 animate-spin" />
                  {{ phaseLabel }}
                </div>
              </div>
            </div>
          </template>

          <!-- Ask-user prompt -->
          <div v-if="store.pendingAsk" class="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4 space-y-3 animate-fade-in">
            <div class="flex items-center gap-2 text-sm">
              <AlertTriangle class="h-4 w-4 text-amber-500" />
              <span class="font-medium">{{ t('awaiting_input') }}</span>
            </div>
            <p class="text-sm leading-7">{{ store.pendingAsk.question }}</p>
            <form @submit.prevent="answerAsk" class="flex gap-2">
              <Input
                v-model="askAnswer"
                :type="store.pendingAsk.sensitive ? 'password' : 'text'"
                :placeholder="t('your_answer')"
                autofocus
              />
              <Button type="submit" :disabled="!askAnswer">
                <Send class="h-4 w-4" />
                <span class="hidden sm:inline">{{ t('submit') }}</span>
              </Button>
            </form>
          </div>
        </div>
      </div>

      <!-- Composer -->
      <div class="border-t border-border bg-background/80 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
        <div class="max-w-3xl mx-auto px-3 sm:px-6 py-3 space-y-2">
          <!-- Mode toolbar -->
          <div class="flex items-center gap-2 flex-wrap">
            <ModeSwitcher :mode="currentMode" @update:mode="setMode" @change-cwd="setCwd" @open-installer="openInstaller" />
            <span v-if="store.activeCwd" class="text-[10.5px] text-muted-foreground font-mono truncate hidden sm:inline" dir="ltr" :title="store.activeCwd">
              📂 {{ store.activeCwd }}
            </span>
          </div>

          <div
            class="rounded-2xl border border-border bg-card shadow-sm p-1.5 flex flex-col gap-1.5"
            :class="voice.recording.value && 'ring-2 ring-red-500/40 border-red-500/40'"
            @dragover.prevent
            @drop="onComposerDrop"
          >
            <!-- Pending image attachments (above the text row) -->
            <div v-if="attachments.length" class="flex flex-wrap gap-1.5 px-1">
              <div
                v-for="(a, idx) in attachments" :key="idx"
                class="relative rounded-md overflow-hidden border border-border bg-background h-16 w-16 group/att"
              >
                <img :src="a.preview" class="h-full w-full object-cover" alt="" />
                <div v-if="a.uploading" class="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 class="h-4 w-4 animate-spin text-white" />
                </div>
                <button
                  type="button"
                  @click="removeAttachment(a)"
                  class="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/70 text-white inline-flex items-center justify-center opacity-0 group-hover/att:opacity-100 focus:opacity-100 transition"
                  :title="t('image_remove')"
                >
                  <XIcon class="h-2.5 w-2.5" />
                </button>
              </div>
            </div>

            <!-- Text + action row -->
            <div class="flex items-end gap-1.5">
              <!-- Attach image button -->
              <Button
                variant="ghost"
                size="icon"
                class="rounded-xl shrink-0"
                :disabled="store.streaming"
                @click="pickImage"
                :title="t('image_attach')"
              >
                <ImageIcon class="h-4 w-4" />
              </Button>
              <input
                ref="imgInputRef"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                multiple
                class="hidden"
                @change="onImagePicked"
              />

              <!-- Mic button -->
              <Button
                :variant="voice.recording.value ? 'destructive' : 'ghost'"
                size="icon"
                class="rounded-xl shrink-0"
                :disabled="store.streaming || voice.transcribing.value"
                @click="toggleVoice"
                :title="t('voice_input')"
              >
                <Loader2 v-if="voice.transcribing.value" class="h-4 w-4 animate-spin" />
                <MicOff v-else-if="voice.recording.value" class="h-4 w-4" />
                <Mic v-else class="h-4 w-4" />
              </Button>

              <Textarea
                ref="composerRef"
                v-model="input"
                @keydown="onComposerKeydown"
                @input="autoResize"
                @paste="onComposerPaste"
                rows="1"
                :placeholder="voice.recording.value ? t('voice_transcribing') : t('composer_placeholder')"
                :disabled="store.streaming || !!store.pendingAsk || voice.recording.value || voice.transcribing.value"
                class="border-0 focus-visible:ring-0 shadow-none resize-none min-h-[40px] max-h-[200px] bg-transparent py-2 px-3 flex-1"
              />

            <!-- Recording indicator -->
            <div v-if="voice.recording.value" class="flex items-center gap-1.5 px-2 text-xs text-red-500 self-center shrink-0">
              <span class="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span class="font-mono">{{ recDuration() }}</span>
            </div>

            <Button
              v-if="store.streaming"
              variant="destructive"
              size="icon"
              class="rounded-xl shrink-0"
              @click="store.stopStream()"
              :title="t('stop')"
            >
              <Square class="h-4 w-4" />
            </Button>
            <Button
              v-else
              size="icon"
              class="rounded-xl shrink-0"
              :disabled="(!input.trim() && attachments.filter((a) => a.url && !a.uploading).length === 0) || attachments.some((a) => a.uploading) || !!store.pendingAsk || voice.recording.value || voice.transcribing.value"
              @click="send"
              :title="t('send')"
            >
              <ArrowUp class="h-4 w-4" />
            </Button>
            </div>
          </div>
          <p v-if="imgErr" class="text-[10.5px] text-destructive mt-1.5 px-1 text-center sm:text-start">{{ imgErr }}</p>
          <p v-if="voiceErrMsg" class="text-[10.5px] text-destructive mt-1.5 px-1 text-center sm:text-start">{{ voiceErrMsg }}</p>
          <p v-else class="text-[10.5px] text-muted-foreground mt-1.5 px-1 text-center sm:text-start leading-relaxed">
            {{ t('composer_hint') }}
            <span class="hidden sm:inline" dir="ltr"> · ⌘K palette · ⌘N new · ⌘E files · ⌘G git · ⌘H hosts · ⌘I CLIs</span>
          </p>
        </div>
      </div>
    </main>

    <!-- Overlays -->
    <CommandPalette
      :open="paletteOpen"
      @update:open="(v) => paletteOpen = v"
      @open-file-explorer="fileExplorerOpen = true"
      @open-git-panel="gitPanelOpen = true"
      @open-hosts-panel="hostsPanelOpen = true"
      @open-installer="openInstaller"
    />
    <FileExplorer :open="fileExplorerOpen" @update:open="(v) => fileExplorerOpen = v" />
    <GitPanel :open="gitPanelOpen" @update:open="(v) => gitPanelOpen = v" />
    <HostsPanel :open="hostsPanelOpen" @update:open="(v) => hostsPanelOpen = v" />
    <SessionImporter :open="importerOpen" @update:open="(v) => importerOpen = v" @imported="store.loadChats()" />
    <AgentInstallerDialog
      :open="installerOpen"
      :initial-tool="installerInitial.tool"
      :initial-tab="installerInitial.tab"
      @update:open="(v) => installerOpen = v"
      @changed="store.detectCLIs()"
    />

    <Dialog
      :open="!!renameTarget"
      :title="t('rename_chat')"
      @update:open="(v) => { if (!v) renameTarget = null; }"
    >
      <form @submit.prevent="commitRename" class="space-y-3">
        <Label>{{ t('new_name') }}</Label>
        <Input v-model="renameTitle" autofocus />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="outline" @click="renameTarget = null">{{ t('cancel') }}</Button>
          <Button type="submit">{{ t('save') }}</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
