<script setup>
import { computed } from 'vue';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps({
  open: Boolean,
  title: String,
  description: String,
  /** sm = 24rem, default = 32rem, lg = 42rem, xl = 56rem */
  size: { type: String, default: 'md' },
});
defineEmits(['update:open']);

const widthClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'max-w-sm';
    case 'lg': return 'max-w-2xl';
    case 'xl': return 'max-w-4xl';
    default:   return 'max-w-lg';
  }
});
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <DialogContent :class="cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg rounded-lg animate-fade-in max-h-[90vh] overflow-y-auto scrollbar-thin',
        widthClass,
      )">
        <DialogTitle v-if="title" class="text-lg font-semibold">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="text-sm text-muted-foreground">{{ description }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
