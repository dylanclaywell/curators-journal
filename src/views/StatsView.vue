<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// Phase 2 replaces this with the hiscores lookup and the skills grid.
</script>

<template>
  <div class="flex flex-col items-start gap-3 p-3">
    <AppIcon name="chart" :size="40" class="text-ink-soft" />
    <p class="m-0 font-display text-[19px] leading-tight">No account set</p>
    <p class="m-0 max-w-[46ch] text-ink-soft">
      Enter your username to read levels from the hiscores. They feed the quest
      queue, so it knows what you already qualify for.
    </p>
    <button
      type="button"
      class="tap pressable bevel-oak mt-1 flex items-center gap-2 bg-brown px-3.5 font-bold text-gold engraved"
    >
      <AppIcon name="search" :size="15" />
      Set username
    </button>
  </div>
</template>
