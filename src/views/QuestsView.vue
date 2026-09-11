<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useQuestsStore } from '@/stores/quests'
import type { QuestProgress } from '@/lib/quests'

/*
 * The Quests panel: browsing, searching and filtering the full dataset, and
 * adding quests to the queue. Quest detail — tapping into a single quest for
 * its full requirements — is slice 4d; a row's tap target here is reserved
 * for that, which is why "add to queue" gets its own button instead.
 */
const quests = useQuestsStore()

onMounted(() => void quests.ensureReady())

const search = ref('')

type StatusFilter = 'all' | QuestProgress
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
]
const statusFilter = ref<StatusFilter>('all')

/**
 * Off by default rather than hidden when levels are unknown: a companion app
 * fetches in the background, and a control that appears mid-session is more
 * confusing than one that's present but explained. See the caption below.
 */
const startableOnly = ref(false)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return quests.index.all.filter((quest) => {
    if (term && !quest.name.toLowerCase().includes(term)) return false
    if (
      statusFilter.value !== 'all' &&
      quests.progressOf(quest.id) !== statusFilter.value
    ) {
      return false
    }
    if (startableOnly.value && quests.levelsKnown) {
      const status = quests.statuses.get(quest.id)
      if (!status || status.progress === 'done' || !status.canStart)
        return false
    }
    return true
  })
})

/**
 * A colored left edge rather than a rounded dot — square corners are the art
 * direction's rule (see CLAUDE.md), and red/amber/green is the in-game
 * journal's own vocabulary for exactly this.
 */
const STATUS_BORDER: Record<QuestProgress, string> = {
  todo: 'border-l-todo',
  doing: 'border-l-doing',
  done: 'border-l-done',
}

function statusBorderClass(id: string): string {
  return STATUS_BORDER[quests.progressOf(id)]
}
</script>

<template>
  <div class="flex flex-col gap-2 p-3">
    <!-- Sticky, so search and filters stay reachable without scrolling back
         up through 214 rows — the touch-first rule against hiding a needed
         control. -->
    <div class="sticky top-0 z-10 flex flex-col gap-2 bg-parchment pb-2">
      <div class="relative flex">
        <AppIcon
          name="search"
          :size="15"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
        />
        <input
          v-model="search"
          type="text"
          inputmode="search"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search quests"
          class="tap bevel-in w-full bg-parchment-2 pl-8 pr-2 text-[16px] text-ink placeholder:text-ink-soft/60"
        />
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="opt in STATUS_FILTERS"
          :key="opt.value"
          type="button"
          class="tap pressable bevel-oak px-3 text-[13px] font-bold"
          :class="
            statusFilter === opt.value
              ? 'bevel-oak-in bg-brown text-gold engraved'
              : 'bg-brown-lt text-parchment-3'
          "
          @click="statusFilter = opt.value"
        >
          {{ opt.label }}
        </button>
        <button
          type="button"
          :disabled="!quests.levelsKnown"
          class="tap pressable bevel-oak px-3 text-[13px] font-bold disabled:opacity-50"
          :class="
            startableOnly
              ? 'bevel-oak-in bg-brown text-gold engraved'
              : 'bg-brown-lt text-parchment-3'
          "
          @click="startableOnly = !startableOnly"
        >
          Startable now
        </button>
      </div>

      <!-- Visible rather than a disabled-button tooltip — "never put
           information behind hover". -->
      <p v-if="!quests.levelsKnown" class="m-0 text-[13px] text-ink-soft">
        Add your username in Stats to filter by what you can start.
      </p>
    </div>

    <p v-if="quests.loading" class="m-0 text-[15px] text-ink-soft">
      Loading quests…
    </p>

    <template v-else>
      <p class="nums m-0 text-[13px] text-ink-soft">
        {{ filtered.length }} of {{ quests.index.all.length }} quests
      </p>

      <p v-if="filtered.length === 0" class="m-0 text-[15px] text-ink-soft">
        No quests match these filters.
      </p>

      <ul class="m-0 flex list-none flex-col p-0">
        <li
          v-for="quest in filtered"
          :key="quest.id"
          class="flex items-center gap-2 border-b-2 border-b-bevel-dk/20 border-l-4 py-2 pl-2 pr-1"
          :class="statusBorderClass(quest.id)"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-[15px] leading-tight">
              {{ quest.name }}
            </div>
            <div class="truncate text-[12px] text-ink-soft">
              {{ quest.difficulty ?? 'Unknown difficulty' }}
              &middot; {{ quest.questPoints }} qp
              <template v-if="!quest.members">&middot; F2P</template>
            </div>
          </div>

          <button
            type="button"
            :aria-label="
              quests.isGoal(quest.id) ? 'Remove from queue' : 'Add to queue'
            "
            class="tap pressable bevel-oak flex w-11 shrink-0 items-center justify-center"
            :class="
              quests.isGoal(quest.id)
                ? 'bevel-oak-in bg-brown text-gold'
                : 'bg-brown-lt text-parchment-3'
            "
            @click="quests.toggleGoal(quest.id)"
          >
            <AppIcon
              :name="quests.isGoal(quest.id) ? 'check' : 'plus'"
              :size="16"
            />
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
