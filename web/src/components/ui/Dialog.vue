<script setup>
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { cn } from '@/lib/utils';
defineProps({ open: Boolean, title: String, description: String });
defineEmits(['update:open']);
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <DialogContent :class="cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg rounded-lg animate-fade-in',
      )">
        <DialogTitle v-if="title" class="text-lg font-semibold">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="text-sm text-muted-foreground">{{ description }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
