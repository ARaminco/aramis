<script setup>
import { cn } from '@/lib/utils';
defineProps({ modelValue: { type: [String, Number], default: '' } });
defineEmits(['update:modelValue']);
</script>

<template>
  <select
    :value="modelValue"
    @change="$emit('update:modelValue', $event.target.value)"
    :class="cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm',
      'focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      $attrs.class,
    )"
    v-bind="{ ...$attrs, class: undefined }"
  >
    <slot />
  </select>
</template>
