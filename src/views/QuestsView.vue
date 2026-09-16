<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useQuestsStore } from '@/stores/quests'
import type { QuestProgress } from '@/lib/quests'

/*
 * The Quests panel: browsing, searching and filtering the full dataset,
 * adding quests to the queue, and opening a quest's own detail. Tapping a
 * row opens detail (4d); add-to-queue gets its own button precisely so it
 * doesn't collide with that.
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
 * A colored stripe rather than a rounded dot — square corners are the art
 * direction's rule (see CLAUDE.md), and red/amber/green is the in-game
 * journal's own vocabulary for exactly this. A standalone element, not a
 * `border-l` on the row: the row itself is now a real oak button
 * (`bevel-oak`), and layering a status border on top of that class risks the
 * same cascade fight documented on the requirement rows in
 * QuestDetailView.vue — a separate flex child sidesteps it entirely.
 */
const STATUS_STRIPE: Record<QuestProgress, string> = {
  todo: 'bg-todo',
  doing: 'bg-doing',
  done: 'bg-done',
}

function statusStripeClass(id: string): string {
  return STATUS_STRIPE[quests.progressOf(id)]
}

/**
 * The stripe says todo/doing/done — progress, not eligibility — so a
 * blocked-but-not-started quest looks identical to a startable one without
 * this. Deliberately conservative to match the engine's one rule: only ever
 * true once levels are actually known, never while they're still loading or
 * absent, and only for `todo` — canStart isn't decision-relevant once a
 * quest is already doing or done.
 */
function isBlocked(id: string): boolean {
  if (!quests.levelsKnown || quests.progressOf(id) !== 'todo') return false
  return quests.statuses.get(id)?.canStart === false
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

      <ul class="m-0 flex flex-col gap-1.5 p-0">
        <li
          v-for="quest in filtered"
          :key="quest.id"
          class="flex items-stretch"
        >
          <!-- 8px, not 4: against oak these three separate by hue rather
               than by contrast (todo 1.26, doing 1.78, done 1.45 against
               #57432a), and doing sits 9° from the wood's own hue. A 4px
               sliver is too little area to read a hue from, which made
               doing look like a lighter plank. -->
          <span
            class="w-2 shrink-0"
            :class="statusStripeClass(quest.id)"
            aria-hidden="true"
          />

          <!-- One oak block, matching the mockup — but a <button> can't nest
               inside the <a> a RouterLink renders, so the link and the
               add-to-queue button are siblings here, not link-then-button.
               `.stretched-link` (see style.css) expands the anchor's own hit
               area to fill this whole `relative` block; the button rides
               above it with `relative z-10` so it keeps capturing its own
               clicks instead of the link swallowing them. -->
          <div
            class="bevel-oak relative flex min-w-0 flex-1 items-center gap-1 bg-brown-lt py-1.5 pl-3 pr-3"
          >
            <RouterLink
              :to="`/quests/${quest.id}`"
              class="tap stretched-link flex min-w-0 flex-1 flex-col justify-center text-gold no-underline"
            >
              <!-- Struck through when done, the way a journal entry gets
                   crossed off. The stripe already says it; this says it
                   without having to look left, which is what makes a long
                   scrolled list readable.

                   1px, not 2: `.engraved` puts a hard black shadow under the
                   text and that shadow falls under the decoration line too,
                   so a 2px strike renders as 2px of gold plus a 1px black
                   echo and swallows the letterforms. -->
              <span
                class="block truncate text-[15px] font-bold leading-tight engraved"
                :class="{
                  'line-through decoration-1':
                    quests.progressOf(quest.id) === 'done',
                }"
              >
                {{ quest.name }}
              </span>
              <span
                class="flex items-center gap-1 text-[12px] text-parchment-3"
              >
                <!-- Blocked, not just "not started" — the stripe alone can't
                     say that, since it's the same red either way. -->
                <AppIcon
                  v-if="isBlocked(quest.id)"
                  name="padlock"
                  :size="10"
                  class="pointer-events-none shrink-0 text-todo"
                  aria-hidden="true"
                />
                <span class="min-w-0 truncate">
                  {{ quest.difficulty ?? 'Unknown difficulty' }}
                  &middot; {{ quest.questPoints }} qp
                  <template v-if="!quest.members">&middot; F2P</template>
                </span>
              </span>
            </RouterLink>

            <button
              type="button"
              :aria-label="
                quests.isGoal(quest.id) ? 'Remove from queue' : 'Add to queue'
              "
              class="tap pressable bevel-oak relative z-10 flex w-11 shrink-0 items-center justify-center"
              :class="
                quests.isGoal(quest.id)
                  ? 'bevel-oak-in bg-brown text-gold'
                  : 'bg-brown-dk text-parchment-3'
              "
              @click="quests.toggleGoal(quest.id)"
            >
              <AppIcon
                :name="quests.isGoal(quest.id) ? 'check' : 'plus'"
                :size="16"
              />
            </button>

            <!-- Decorative and inert (`pointer-events-none`): without that,
                 this being a *positioned* sibling of the stretched-link
                 anchor (even unintentionally, e.g. via a stray `relative`)
                 is enough to paint it above the anchor's stretched hit area
                 and swallow taps meant for navigation. `chevron` (an open
                 notch, not `caretDown` rotated) because a filled triangle
                 reads as a play button once it points sideways. -->
            <AppIcon
              name="chevron"
              :size="12"
              class="pointer-events-none ml-1 shrink-0 text-gold"
              aria-hidden="true"
            />
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
