<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// Phase 4 replaces this with the queue: prerequisites expanded in order, and
// the next actionable step pinned to the top.
</script>

<template>
  <!-- An empty panel is an invitation, not a blank. -->
  <div class="flex flex-col items-start gap-3 p-3">
    <AppIcon name="scroll" :size="40" class="text-ink-soft" />
    <p class="m-0 font-display text-[19px] leading-tight">
      Your queue is empty
    </p>
    <p class="m-0 max-w-[46ch] text-ink-soft">
      Add a quest and StageScape works backwards through what it needs, then
      tells you what you can start right now.
    </p>
    <button
      type="button"
      class="tap pressable bevel-oak mt-1 flex items-center gap-2 bg-brown px-3.5 font-bold text-gold engraved"
    >
      <AppIcon name="plus" :size="15" />
      Add a quest
    </button>
  </div>
</template>
