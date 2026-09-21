<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { sortByKills, sortByName } from '@/lib/bosses'
import { useBossesStore } from '@/stores/bosses'

/*
 * The Bosses panel: kill counts for the 71 bosses Jagex publishes them for,
 * and the other 112 the wiki documents, in one list.
 *
 * The list is both a tracker and a reference, and the rows say which they are
 * rather than implying a number that doesn't exist. See ROADMAP.md Phase 7.
 */
const bosses = useBossesStore()

onMounted(() => void bosses.ensureReady())

const search = ref('')

type Filter = 'all' | 'tracked' | 'killed'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tracked', label: 'Tracked' },
  { value: 'killed', label: 'Killed' },
]
const filter = ref<Filter>('all')

/*
 * Kills first by default, because the panel's first question is "what have I
 * killed" — but 112 rows can only ever answer the second question, so A–Z is
 * one tap away rather than buried.
 */
const order = ref<'kills' | 'name'>('kills')

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  const rows = bosses.rows.filter((row) => {
    if (term && !row.boss.name.toLowerCase().includes(term)) return false
    if (filter.value === 'tracked' && !row.tracked) return false
    if (filter.value === 'killed' && !(row.kills && row.kills > 0)) return false
    return true
  })
  return order.value === 'kills' ? sortByKills(rows) : sortByName(rows)
})

/** The headline version of the honesty the rows carry individually. */
const summary = computed(() => {
  const { killed, tracked, total } = bosses.totals
  if (!bosses.countsKnown)
    return `${total} bosses · ${tracked} with kill counts`
  return `${killed} of ${tracked} killed · ${total - tracked} without kill counts`
})
</script>

<template>
  <div class="flex flex-col gap-2 p-3">
    <!-- Same sticky treatment and z-20 as the Quests panel: 183 rows is a long
         way to scroll back for a filter. -->
    <div class="sticky top-0 z-20 flex flex-col gap-2 bg-parchment pb-2">
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
          placeholder="Search bosses"
          class="tap bevel-in w-full bg-parchment-2 pl-8 pr-2 text-[16px] text-ink placeholder:text-ink-soft/60"
        />
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="opt in FILTERS"
          :key="opt.value"
          type="button"
          class="tap pressable bevel-oak px-3 text-[13px] font-bold"
          :class="
            filter === opt.value
              ? 'bevel-oak-in bg-brown text-gold engraved'
              : 'bg-brown-lt text-parchment-3'
          "
          @click="filter = opt.value"
        >
          {{ opt.label }}
        </button>
        <button
          type="button"
          :aria-label="
            order === 'kills' ? 'Sort alphabetically' : 'Sort by kill count'
          "
          class="tap pressable bevel-oak bevel-oak-in bg-brown px-3 text-[13px] font-bold text-gold engraved"
          @click="order = order === 'kills' ? 'name' : 'kills'"
        >
          {{ order === 'kills' ? 'Kills' : 'A–Z' }}
        </button>
      </div>

      <!-- Visible, not behind a tooltip: that 112 is most of the list, and a
           player scanning for a kill count needs to know why two thirds of the
           rows don't have one. -->
      <p class="nums m-0 text-[13px] text-ink-soft">{{ summary }}</p>
      <p v-if="!bosses.countsKnown" class="m-0 text-[13px] text-ink-soft">
        Add your username in Stats to see kill counts.
      </p>
      <!-- Drift: Jagex shipped a boss since the dataset was generated. Not an
           error, and not silent either. -->
      <p
        v-if="bosses.unknownActivities.length"
        class="m-0 text-[13px] text-ink-soft"
      >
        The hiscores list
        <span class="nums">{{ bosses.unknownActivities.length }}</span>
        activit<template v-if="bosses.unknownActivities.length === 1"
          >y</template
        ><template v-else>ies</template> this build doesn't know about.
      </p>
    </div>

    <p v-if="bosses.loading" class="m-0 text-[15px] text-ink-soft">
      Loading bosses…
    </p>

    <template v-else>
      <p v-if="filtered.length === 0" class="m-0 text-[15px] text-ink-soft">
        No bosses match these filters.
      </p>

      <ul class="m-0 flex flex-col gap-1.5 p-0">
        <li
          v-for="row in filtered"
          :key="row.boss.id"
          class="bevel-oak flex min-w-0 items-center gap-2 bg-brown-lt py-1.5 pl-3 pr-3"
        >
          <span class="flex min-w-0 flex-1 flex-col justify-center">
            <span
              class="block truncate text-[15px] font-bold leading-tight text-gold engraved"
            >
              {{ row.boss.name }}
            </span>
            <span class="flex items-center gap-1 text-[12px] text-parchment-3">
              <span class="min-w-0 truncate">
                <template v-if="row.boss.variantOf">Harder mode</template>
                <template v-else-if="row.boss.versions[0]?.combatLevel">
                  Combat {{ row.boss.versions[0].combatLevel }}
                </template>
                <template v-else>Boss</template>
                <template v-if="!row.boss.members"> · F2P</template>
                <template v-if="row.rank !== null">
                  · rank
                  <span class="nums">{{ row.rank.toLocaleString() }}</span>
                </template>
              </span>
            </span>
          </span>

          <!-- The three states, rendered as three different things.

               Untracked is an em dash and a label, never a zero: the hiscores
               publish no count for this boss for anyone. Unscored genuinely is
               zero — every boss appears from the first kill — so it says 0
               rather than hedging. -->
          <span class="flex shrink-0 flex-col items-end">
            <template v-if="!row.tracked">
              <span class="text-[15px] leading-tight text-parchment-3">—</span>
              <span class="text-[11px] text-parchment-3">not counted</span>
            </template>
            <template v-else-if="!bosses.countsKnown">
              <span class="text-[15px] leading-tight text-parchment-3">—</span>
            </template>
            <template v-else>
              <span
                class="nums text-[15px] font-bold leading-tight engraved"
                :class="row.kills ? 'text-gold' : 'text-parchment-3'"
              >
                {{ (row.kills ?? 0).toLocaleString() }}
              </span>
              <span class="text-[11px] text-parchment-3">kills</span>
            </template>
          </span>
        </li>
      </ul>
    </template>
  </div>
</template>
