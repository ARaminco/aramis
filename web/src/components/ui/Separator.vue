<script setup>
import { cn } from '@/lib/utils';
defineProps({ orientation: { type: String, default: 'horizontal' } });
</script>

<template>
  <div
    role="separator"
    :class="cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
      $attrs.class,
    )"
    v-bind="{ ...$attrs, class: undefined }"
  />
</template>
