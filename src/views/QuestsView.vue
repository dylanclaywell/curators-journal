<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useQuestsStore } from '@/stores/quests'
import type { QuestProgress } from '@/lib/quests'

/*
 * The Quests panel: browsing and searching the full dataset. Filters and
 * add-to-queue land in the next slice — this is search over a flat list,
 * which is already enough to answer "is this quest in the game" and "what
 * does it need".
 */
const quests = useQuestsStore()

onMounted(() => void quests.ensureReady())

const search = ref('')

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  const all = quests.index.all
  if (!term) return all
  return all.filter((quest) => quest.name.toLowerCase().includes(term))
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
    <!-- Sticky, so search stays reachable without scrolling back up through
         214 rows — the touch-first rule against hiding a needed control. -->
    <div class="sticky top-0 z-10 bg-parchment pb-2">
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
    </div>

    <p v-if="quests.loading" class="m-0 text-[15px] text-ink-soft">
      Loading quests…
    </p>

    <template v-else>
      <p class="nums m-0 text-[13px] text-ink-soft">
        {{ filtered.length }} of {{ quests.index.all.length }} quests
      </p>

      <p v-if="filtered.length === 0" class="m-0 text-[15px] text-ink-soft">
        No quest matches "{{ search }}".
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
        </li>
      </ul>
    </template>
  </div>
</template>
