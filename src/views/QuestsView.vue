<script setup lang="ts">
import { onMounted } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useQuestsStore } from '@/stores/quests'

/*
 * The Quests panel: browsing and searching the full 214-quest dataset,
 * split out from the Queue panel per ROADMAP's "Two panels, not one". The
 * list, search and filters are slice 4c proper — this is the placeholder the
 * registry split leaves behind, calling `ensureReady()` on its own rather
 * than assuming the Queue panel mounted first.
 */
const quests = useQuestsStore()

onMounted(() => void quests.ensureReady())
</script>

<template>
  <div class="flex flex-col items-start gap-3 p-3">
    <AppIcon name="openBook" :size="40" class="text-ink-soft" />
    <p class="m-0 font-display text-[19px] leading-tight">
      Quest list coming soon
    </p>
    <p class="m-0 max-w-[46ch] text-ink-soft">
      Search and filter all {{ quests.index.all.length || 214 }} quests here,
      and add any of them to your queue.
    </p>
  </div>
</template>
