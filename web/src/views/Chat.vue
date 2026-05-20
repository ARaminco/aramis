<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
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
import {
  Plus, Send, Settings, Square, Trash2, Pencil, MessageSquare, Bot, User,
  Sparkles, AlertTriangle, Sun, Moon, LogOut, Menu, X as XIcon, Globe, Loader2, ArrowUp,
  Mic, MicOff,
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
const renameTarget = ref(null);
const renameTitle = ref('');
const sidebarOpen = ref(false);

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
  try { const { config } = await api.getAIConfig(); aiConfigured.value = !!(config && config.model); }
  catch { aiConfigured.value = false; }

  const id = route.params.id || store.chats[0]?.id;
  if (id) await openChat(id);
});

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
  const id = await store.createChat();
  router.replace({ name: 'chat', params: { id } });
  sidebarOpen.value = false;
}

async function pickChat(id) {
  router.replace({ name: 'chat', params: { id } });
}

async function send() {
  const txt = input.value.trim();
  if (!txt || store.streaming) return;
  input.value = '';
  autoResize();
  if (!store.activeId) {
    const id = await store.createChat();
    router.replace({ name: 'chat', params: { id } });
  }
  await store.sendMessage(txt);
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
</script>

<template>
  <div class="flex h-[100dvh] overflow-hidden bg-background text-foreground">
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
      <div class="p-3 flex items-center gap-2 border-b border-border">
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

      <div class="px-3 py-3">
        <Button class="w-full" @click="newChat">
          <Plus class="h-4 w-4" /> {{ t('new_chat') }}
        </Button>
      </div>

      <div class="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {{ t('chats') }}
      </div>
      <div class="flex-1 overflow-y-auto scrollbar-thin px-2">
        <div v-if="store.chats.length === 0" class="text-xs text-muted-foreground p-4 text-center">
          {{ t('no_chats') }}
        </div>
        <button
          v-for="c in store.chats"
          :key="c.id"
          @click="pickChat(c.id)"
          :class="[
            'group w-full text-start rounded-md px-2.5 py-2 my-0.5 text-sm transition flex items-center gap-2',
            store.activeId === c.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
          ]"
        >
          <MessageSquare class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span class="truncate flex-1 min-w-0">{{ c.title || t('new_chat') }}</span>
          <span class="opacity-0 group-hover:opacity-100 md:flex gap-1 hidden">
            <span class="p-1 rounded hover:bg-background/60" @click.stop="startRename(c)"><Pencil class="h-3.5 w-3.5" /></span>
            <span class="p-1 rounded hover:bg-background/60" @click.stop="deleteChat(c)"><Trash2 class="h-3.5 w-3.5 text-destructive" /></span>
          </span>
        </button>
      </div>

      <div class="border-t border-border p-2 flex items-center gap-1">
        <Button variant="ghost" size="sm" class="flex-1 justify-start" @click="gotoSettings">
          <Settings class="h-4 w-4" /> {{ t('settings') }}
        </Button>
        <Button variant="ghost" size="icon" @click="logout" :title="t('logout')">
          <LogOut class="h-4 w-4" />
        </Button>
      </div>
      <a
        href="https://aramin.co"
        target="_blank"
        rel="noopener"
        class="text-[10px] text-muted-foreground/70 hover:text-foreground text-center py-1.5 border-t border-border transition"
        dir="ltr"
      >
        Built by Aliasghar Ramin · aramin.co
      </a>
    </aside>

    <!-- Main -->
    <main class="flex-1 flex flex-col min-w-0 relative">
      <!-- Top bar (mobile + chat title on all sizes) -->
      <header class="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card/40 backdrop-blur-sm">
        <Button variant="ghost" size="icon" class="md:hidden" @click="sidebarOpen = true">
          <Menu class="h-5 w-5" />
        </Button>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">{{ activeChatTitle }}</div>
        </div>
        <Button v-if="store.activeId" variant="ghost" size="icon" class="md:hidden" @click="newChat">
          <Plus class="h-5 w-5" />
        </Button>
      </header>

      <div v-if="!aiConfigured" class="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2 text-xs">
        <AlertTriangle class="h-4 w-4 text-amber-500 shrink-0" />
        <span class="flex-1">{{ t('ai_not_configured_banner') }}</span>
        <Button size="sm" variant="outline" @click="gotoSettings">{{ t('configure') }}</Button>
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
            <div v-if="m.role === 'user'" class="flex gap-2.5 justify-end animate-fade-in">
              <div class="rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-3.5 py-2.5 max-w-[85%] sm:max-w-[80%] whitespace-pre-wrap text-sm leading-relaxed shadow-sm">
                {{ m.content }}
              </div>
              <div class="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <User class="h-3.5 w-3.5" />
              </div>
            </div>

            <!-- Inline answer to ask_user -->
            <div v-else-if="m.role === 'ask_answer'" class="flex gap-2.5 justify-end animate-fade-in">
              <div class="rounded-xl bg-amber-500/15 border border-amber-500/30 text-foreground px-3 py-2 max-w-[85%] text-sm">
                <div class="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-0.5">↩ {{ t('your_answer') }}</div>
                <div class="font-mono" dir="ltr">{{ m.content }}</div>
              </div>
            </div>

            <!-- Assistant -->
            <div v-else-if="m.role === 'assistant'" class="flex gap-2.5 animate-fade-in">
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
        <div class="max-w-3xl mx-auto px-3 sm:px-6 py-3">
          <div class="rounded-2xl border border-border bg-card shadow-sm flex items-end gap-1.5 p-1.5"
               :class="voice.recording.value && 'ring-2 ring-red-500/40 border-red-500/40'">

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
              rows="1"
              :placeholder="voice.recording.value ? t('voice_transcribing') : t('composer_placeholder')"
              :disabled="store.streaming || !!store.pendingAsk || voice.recording.value || voice.transcribing.value"
              class="border-0 focus-visible:ring-0 shadow-none resize-none min-h-[40px] max-h-[200px] bg-transparent py-2 px-3"
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
              :disabled="!input.trim() || !!store.pendingAsk || voice.recording.value || voice.transcribing.value"
              @click="send"
              :title="t('send')"
            >
              <ArrowUp class="h-4 w-4" />
            </Button>
          </div>
          <p v-if="voiceErrMsg" class="text-[10.5px] text-destructive mt-1.5 px-1 text-center sm:text-start">{{ voiceErrMsg }}</p>
          <p v-else class="text-[10.5px] text-muted-foreground mt-1.5 px-1 text-center sm:text-start leading-relaxed">
            {{ t('composer_hint') }}
          </p>
        </div>
      </div>
    </main>

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
