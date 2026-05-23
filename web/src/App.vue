<script setup>
import { RouterView } from 'vue-router';
</script>

<template>
  <div class="h-[100dvh] bg-background text-foreground flex flex-col overflow-hidden">
    <!-- Dedicated draggable strip for macOS traffic-light buttons. Only renders
         in Electron+mac (CSS-gated). Acts as a window drag handle without
         overlapping any chrome below it. -->
    <div class="electron-titlebar-strip" />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <RouterView />
    </div>
  </div>
</template>
