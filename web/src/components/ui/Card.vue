<script setup>
import { cn } from '@/lib/utils';
</script>

<template>
  <div :class="cn('rounded-xl border bg-card text-card-foreground shadow-sm', $attrs.class)"
       v-bind="{ ...$attrs, class: undefined }">
    <slot />
  </div>
</template>
