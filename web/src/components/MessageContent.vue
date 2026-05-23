<script setup>
import { computed, onMounted, onUpdated, ref } from 'vue';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github-dark.min.css';
import { copyToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';

const props = defineProps({ text: { type: String, default: '' } });
const { t } = useI18n();
const root = ref(null);

// Configure marked once: GFM + line breaks + syntax highlighting via highlight.js.
// hljs.getLanguage falls back to plain text when the requested language isn't
// loaded, so the call is safe even on unknown fences (e.g. ```mermaid).
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; }
    catch { return code; }
  },
}));
marked.setOptions({ breaks: true, gfm: true });

// Sanitize EVERY rendered chunk. We allow images (chat may include pasted
// images) but explicitly forbid scripts, iframes, object/embed, on*= handlers,
// javascript:/data: schemes on links. DOMPurify is the canonical browser
// sanitizer and is updated whenever new XSS vectors are discovered upstream.
const PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onsubmit', 'onchange', 'onkeydown', 'onkeyup', 'onkeypress'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|aramis|\/uploads|#):/i,
};

const html = computed(() => {
  const md = marked.parse(props.text || '');
  return DOMPurify.sanitize(md, PURIFY_CONFIG);
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
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const code = pre.querySelector('code')?.innerText ?? pre.innerText;
      const ok = await copyToClipboard(code);
      if (ok) {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1300);
      }
    });
    pre.appendChild(btn);
  });

  // Force external links to open in a new tab.
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
