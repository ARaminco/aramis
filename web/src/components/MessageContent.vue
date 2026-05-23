<script setup>
import { computed, onMounted, onUpdated, ref } from 'vue';
import { marked } from 'marked';
import { copyToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';

const props = defineProps({ text: { type: String, default: '' } });
const { t } = useI18n();
const root = ref(null);

marked.setOptions({ breaks: true, gfm: true });

const html = computed(() => {
  const txt = props.text || '';
  return marked.parse(txt);
});

// Inject a small "copy" button into every <pre> in the rendered markdown. We
// run after mount/update so streaming content keeps gaining copy controls.
function attachCopyButtons() {
  if (!root.value) return;
  const pres = root.value.querySelectorAll('pre');
  pres.forEach((pre) => {
    if (pre.dataset.copyAttached === '1') return;
    pre.dataset.copyAttached = '1';
    pre.classList.add('group', 'relative');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-pre-btn';
    btn.setAttribute('aria-label', t('copy'));
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>${t('copy')}</span>`;
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const code = pre.querySelector('code')?.innerText ?? pre.innerText;
      const ok = await copyToClipboard(code);
      if (ok) {
        btn.classList.add('copied');
        const lbl = btn.querySelector('span');
        const prev = lbl ? lbl.textContent : '';
        if (lbl) lbl.textContent = t('copied');
        setTimeout(() => {
          btn.classList.remove('copied');
          if (lbl) lbl.textContent = prev;
        }, 1300);
      }
    });
    pre.appendChild(btn);
  });

  // Make external links open in a new tab.
  root.value.querySelectorAll('a[href^="http"]').forEach((a) => {
    if (!a.target) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  });
}

onMounted(attachCopyButtons);
onUpdated(attachCopyButtons);
</script>

<template>
  <div ref="root" class="prose-chat" dir="auto" v-html="html" />
</template>
