<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useQuestsStore } from '@/stores/quests'

/*
 * The queue panel, still mostly an invitation — the queue itself (goals,
 * expansion, ordering) is slice 4e. What is real here is the whole data path
 * behind it: the committed dataset loads on demand, the engine evaluates it
 * against live levels, and progress survives being backgrounded.
 *
 * "Add a quest" has nowhere to go yet: it wants the Quests panel's list
 * (slice 4c) or quest detail (4d) to hand it a goal.
 */
const quests = useQuestsStore()

// Dataset *and* levels. The panel used to load only the dataset, which meant a
// cold load here showed no levels until Stats had been visited.
onMounted(() => void quests.ensureReady())

/**
 * Deliberately reports nothing until levels exist. With no snapshot every
 * skill reads as unknown, so a count would say "you can start 12 quests" when
 * the truth is "we don't know your levels yet" — the exact overclaim the
 * engine is built to avoid.
 */
const startable = computed(() => {
  if (!quests.levelsKnown) return null
  let count = 0
  for (const status of quests.statuses.values()) {
    if (status.progress !== 'done' && status.canStart) count++
  }
  return count
})

const total = computed(() => quests.index.all.length)
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

    <!-- Proof the data path works, and useful on its own until the queue does.
         `.nums` for tabular figures, so a changing count doesn't reflow. -->
    <p
      v-if="total"
      class="nums m-0 mt-1 border-t-2 border-bevel-dk pt-3 text-[15px] text-ink-soft"
    >
      <template v-if="startable !== null">
        <strong class="font-bold text-ink">{{ startable }}</strong> of
        {{ total }} quests startable now
      </template>
      <!-- Three states, not two: a username that's set but still resolving
           must not be told to set a username. -->
      <template v-else-if="quests.awaitingLevels">
        {{ total }} quests loaded — checking your levels
      </template>
      <template v-else>
        {{ total }} quests loaded — add your username in Stats to see which you
        can start
      </template>
    </p>
  </div>
</template>
