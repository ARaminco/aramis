<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { copyToClipboard } from '@/lib/clipboard';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Card from '@/components/ui/Card.vue';
import {
  ArrowLeft, ArrowRight, History, Sparkles, GitCommit, Calendar, Copy, Check,
  RefreshCw, AlertTriangle, ScrollText,
} from 'lucide-vue-next';

const router = useRouter();
const { t, locale } = useI18n();

const data = ref(null);     // { version, name, markdown, parsed: { prelude, sections } }
const loading = ref(true);
const err = ref('');
const copiedKey = ref('');
const filter = ref('');

marked.setOptions({ breaks: true, gfm: true });

async function load() {
  loading.value = true;
  err.value = '';
  try {
    data.value = await api.getChangelog();
    if (!data.value?.ok) err.value = data.value?.error || t('changelog_missing');
  } catch (e) {
    err.value = e.message;
  } finally { loading.value = false; }
}

onMounted(load);

const sections = computed(() => data.value?.parsed?.sections || []);
const visibleSections = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return sections.value;
  return sections.value.filter((s) =>
    s.version.toLowerCase().includes(q) ||
    (s.markdown || '').toLowerCase().includes(q)
  );
});

function renderMd(md) { return marked.parse(md || ''); }

async function copySection(s) {
  const header = s.isUnreleased ? `## [Unreleased]` : `## [${s.version}]${s.date ? ` - ${s.date}` : ''}`;
  const ok = await copyToClipboard(`${header}\n\n${s.markdown}\n`);
  if (ok) {
    copiedKey.value = s.version;
    setTimeout(() => { copiedKey.value = ''; }, 1400);
  }
}

function back() { router.back(); }
</script>

<template>
  <div class="min-h-[100dvh] bg-background text-foreground">
    <header class="main-header sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" @click="back" :title="t('back')">
          <ArrowRight v-if="locale === 'fa'" class="h-5 w-5" />
          <ArrowLeft v-else class="h-5 w-5" />
        </Button>
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <ScrollText class="h-4 w-4 text-primary shrink-0" />
          <h1 class="text-base font-semibold truncate">{{ t('changelog_title') }}</h1>
          <Badge v-if="data?.version" variant="outline" class="text-[10px] font-mono" dir="ltr">v{{ data.version }}</Badge>
        </div>
        <Button variant="ghost" size="icon" @click="load" :title="t('fs_refresh')">
          <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" />
        </Button>
      </div>
    </header>

    <div class="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <!-- Hero -->
      <Card class="p-5 sm:p-6 relative overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div class="relative flex items-start gap-3">
          <div class="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles class="h-5 w-5 text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[11px] uppercase tracking-wider text-muted-foreground">{{ t('current_version') }}</div>
            <div class="font-mono text-lg sm:text-xl font-semibold" dir="ltr">
              {{ data?.name || 'Aramis' }} <span class="text-primary">v{{ data?.version || '—' }}</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1.5 leading-relaxed">{{ t('changelog_subtitle') }}</p>
          </div>
        </div>
      </Card>

      <!-- Filter -->
      <div class="flex items-center gap-2">
        <input
          v-model="filter"
          type="text"
          :placeholder="t('changelog_filter_ph')"
          class="flex-1 rounded-lg border border-input bg-card/40 px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <div v-if="err" class="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle class="h-4 w-4" />
        <span class="flex-1">{{ err }}</span>
        <code class="text-xs font-mono opacity-60" dir="ltr">npm run release</code>
      </div>

      <!-- Sections -->
      <div v-if="loading" class="text-sm text-muted-foreground text-center py-8">{{ t('loading') }}</div>
      <div v-else-if="visibleSections.length === 0" class="text-sm text-muted-foreground text-center py-8">
        {{ t('changelog_empty') }}
      </div>

      <Card
        v-for="s in visibleSections"
        :key="s.version + (s.date || '')"
        :class="[
          'p-4 sm:p-5 group',
          s.isUnreleased && 'border-amber-500/30 bg-amber-500/[0.03]',
        ]"
      >
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <GitCommit v-if="!s.isUnreleased" class="h-3.5 w-3.5 text-primary" />
          <Sparkles v-else class="h-3.5 w-3.5 text-amber-500" />
          <span class="font-semibold text-sm" dir="ltr">
            <template v-if="s.isUnreleased">{{ t('changelog_unreleased') }}</template>
            <template v-else>v{{ s.version }}</template>
          </span>
          <span v-if="s.date" class="text-[11px] text-muted-foreground inline-flex items-center gap-1" dir="ltr">
            <Calendar class="h-3 w-3" /> {{ s.date }}
          </span>
          <Badge
            v-if="s.isUnreleased"
            class="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
            variant="outline"
          >
            {{ t('changelog_pending') }}
          </Badge>
          <span class="flex-1" />
          <button
            type="button"
            class="opacity-0 group-hover:opacity-100 transition inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            @click="copySection(s)"
          >
            <Check v-if="copiedKey === s.version" class="h-3 w-3 text-emerald-500" />
            <Copy v-else class="h-3 w-3" />
            {{ copiedKey === s.version ? t('copied') : t('copy') }}
          </button>
        </div>
        <div class="prose-chat" v-html="renderMd(s.markdown)" />
      </Card>

      <!-- How to release -->
      <Card class="p-4 sm:p-5 space-y-2 border-dashed">
        <div class="flex items-center gap-2">
          <History class="h-4 w-4 text-muted-foreground" />
          <h3 class="font-medium text-sm">{{ t('changelog_howto_title') }}</h3>
        </div>
        <p class="text-xs text-muted-foreground leading-relaxed">{{ t('changelog_howto_body') }}</p>
        <div class="rounded-md bg-muted/50 p-3 font-mono text-[11px] space-y-1" dir="ltr">
          <div><span class="text-emerald-500">$</span> npm run release -- "Added X feature"</div>
          <div><span class="text-emerald-500">$</span> npm run release -- --minor "Breaking-ish change"</div>
          <div><span class="text-emerald-500">$</span> npm run release -- --dry-run "Preview only"</div>
          <div><span class="text-emerald-500">$</span> npm run release:dry</div>
        </div>
      </Card>
    </div>
  </div>
</template>
