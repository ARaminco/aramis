<script setup>
import { cn } from '@/lib/utils';
defineProps({ modelValue: { type: [String, Number], default: '' } });
defineEmits(['update:modelValue']);
</script>

<template>
  <input
    :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
    :class="cn(
      'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
      'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'disabled:cursor-not-allowed disabled:opacity-50',
      $attrs.class,
    )"
    v-bind="{ ...$attrs, class: undefined }"
  />
</template>
