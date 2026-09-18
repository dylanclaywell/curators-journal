<script setup lang="ts">
import DiaryList from '@/components/DiaryList.vue'

/*
 * Variant A of slice 6e: achievement diaries as their own panel.
 *
 * The cost is in the tab bar, not here — a fifth tab trips the icon-only
 * threshold for *every* panel, so Queue, Quests, Stats and Settings all lose
 * their labels at every width to make room for this one. Whether that trade is
 * worth it is a question for the device, which is why variant B (a mode inside
 * Quests) is running at the same time. See ROADMAP.md Phase 6.
 */
</script>

<template>
  <div class="flex flex-col gap-2 p-3">
    <DiaryList />
  </div>
</template>
