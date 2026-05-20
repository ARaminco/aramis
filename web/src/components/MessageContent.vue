<script setup>
import { computed } from 'vue';
import { marked } from 'marked';
const props = defineProps({ text: { type: String, default: '' } });
marked.setOptions({ breaks: true, gfm: true });
const html = computed(() => {
  const t = props.text || '';
  return marked.parse(t);
});
</script>
<template>
  <div class="prose-chat" v-html="html" />
</template>
