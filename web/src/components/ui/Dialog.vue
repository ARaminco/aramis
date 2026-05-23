<script setup>
import { computed } from 'vue';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { X } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

const props = defineProps({
  open: Boolean,
  title: String,
  description: String,
  /** sm = 24rem, default = 32rem, lg = 42rem, xl = 56rem */
  size: { type: String, default: 'md' },
  /** Hide the explicit close-X in the header (esc + backdrop still work). */
  hideClose: { type: Boolean, default: false },
});
defineEmits(['update:open']);

const widthClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'sm:max-w-sm';
    case 'lg': return 'sm:max-w-2xl';
    case 'xl': return 'sm:max-w-4xl';
    default:   return 'sm:max-w-lg';
  }
});
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <!--
        Mobile-first: full screen on small viewports (no awkward horizontal
        scroll when content is wider than the screen). Above the `sm`
        breakpoint we revert to a centered modal with the requested width.
      -->
      <DialogContent
        :class="cn(
          'fixed inset-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
          'z-50 flex flex-col gap-3 sm:gap-4 bg-background sm:border sm:shadow-lg sm:rounded-lg',
          'w-full sm:w-[min(100%-2rem,42rem)] sm:max-h-[90vh]',
          'p-4 sm:p-6 overflow-y-auto scrollbar-thin animate-fade-in',
          widthClass,
        )"
      >
        <div v-if="title || !hideClose" class="flex items-start gap-2 -mb-1">
          <div class="flex-1 min-w-0">
            <DialogTitle v-if="title" class="text-base sm:text-lg font-semibold truncate">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="text-xs sm:text-sm text-muted-foreground mt-0.5">{{ description }}</DialogDescription>
          </div>
          <DialogClose
            v-if="!hideClose"
            class="shrink-0 -mt-1 -me-1 p-1.5 rounded-md hover:bg-accent transition text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X class="h-4 w-4" />
          </DialogClose>
        </div>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
