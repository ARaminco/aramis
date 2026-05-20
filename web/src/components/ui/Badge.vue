<script setup>
import { computed } from 'vue';
import { cn } from '@/lib/utils';
const props = defineProps({ variant: { type: String, default: 'default' } });
const variants = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-border',
  success: 'bg-emerald-600 text-white',
  destructive: 'bg-destructive text-destructive-foreground',
};
const classes = computed(() => cn(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
  variants[props.variant] || variants.default,
));
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
