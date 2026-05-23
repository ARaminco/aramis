<script setup>
import { ref } from 'vue';
import { Copy, Check } from 'lucide-vue-next';
import { copyToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';

const props = defineProps({
  text: { type: [String, Function], required: true },
  size: { type: String, default: 'sm' },     // 'sm' (h-3 inside h-7) | 'xs'
  variant: { type: String, default: 'ghost' }, // 'ghost' | 'inline'
  label: { type: String, default: '' },       // optional visible label
});

const { t } = useI18n();
const copied = ref(false);
let timer = null;

async function doCopy() {
  const txt = typeof props.text === 'function' ? props.text() : props.text;
  const ok = await copyToClipboard(txt || '');
  if (ok) {
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { copied.value = false; }, 1400);
  }
}
</script>

<template>
  <button
    type="button"
    @click.stop="doCopy"
    :title="copied ? t('copied') : t('copy')"
    :class="[
      'inline-flex items-center justify-center gap-1 transition select-none',
      variant === 'inline'
        ? 'text-[10px] uppercase tracking-wide px-2 py-1 rounded-md bg-black/40 hover:bg-black/60 text-zinc-200'
        : 'rounded-md hover:bg-accent text-muted-foreground hover:text-foreground',
      size === 'xs' ? 'h-5 w-5' : (label ? 'h-7 px-2' : 'h-7 w-7'),
    ]"
  >
    <Check v-if="copied" :class="size === 'xs' ? 'h-3 w-3 text-emerald-500' : 'h-3.5 w-3.5 text-emerald-500'" />
    <Copy v-else :class="size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'" />
    <span v-if="label" class="text-[11px]">{{ copied ? t('copied') : label }}</span>
  </button>
</template>
