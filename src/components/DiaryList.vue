<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useDiariesStore } from '@/stores/diaries'
import { useQuestsStore } from '@/stores/quests'
import type { DiaryTierStatus } from '@/lib/diaries'
import type { DiaryTier } from '@/lib/types'

/*
 * The diary list itself, deliberately separate from where it is mounted.
 *
 * Slice 6e is a placement decision — its own panel, or a mode inside Quests —
 * and the only way to judge that on the device is to have both running at
 * once. Keeping the list here means the two variants differ in exactly one
 * thing: where they sit. Whichever loses gets deleted; this component stays
 * either way.
 */
const diaries = useDiariesStore()
const quests = useQuestsStore()

onMounted(() => void diaries.ensureReady())

/** Which diary is expanded. Null means the overview list. */
const openDiary = ref<string | null>(null)

const readyOnly = ref(false)

const shown = computed(() =>
  diaries.index.all.filter((diary) => {
    if (!readyOnly.value) return true
    return diary.tiers.some((t) => {
      const s = diaries.statuses.get(t.id)
      return s?.canComplete && s.progress !== 'done'
    })
  }),
)

/**
 * The open diary's tiers paired with their statuses, resolved once.
 *
 * The template used to look each of these up per row — and up to four times
 * per task — which read badly and put an id-or-empty-string fallback in a
 * dozen places, each one somewhere to get it subtly wrong.
 */
const openTiers = computed<{ tier: DiaryTier; status?: DiaryTierStatus }[]>(
  () => {
    const diary = openDiary.value
      ? diaries.index.byId.get(openDiary.value)
      : null
    if (!diary) return []
    return diary.tiers.map((tier) => ({
      tier,
      status: diaries.statuses.get(tier.id),
    }))
  },
)

const openName = computed(() =>
  openDiary.value ? diaries.index.byId.get(openDiary.value)?.name : '',
)

const openTaskmaster = computed(() =>
  openDiary.value
    ? diaries.index.byId.get(openDiary.value)?.taskmaster
    : undefined,
)

const STRIPE = { todo: 'bg-todo', doing: 'bg-doing', done: 'bg-done' } as const

/** Tiers done, out of four — the number that reads at a glance in a list row. */
function doneCount(diaryId: string): number {
  const diary = diaries.index.byId.get(diaryId)
  if (!diary) return 0
  return diary.tiers.filter((t) => diaries.progressOf(t.id) === 'done').length
}

/**
 * A tier is "blocked" when its requirements are unmet and it isn't finished.
 * Done and doable stay independent everywhere here: the dataset's levels are
 * the wiki's opinion, the checks are the player's record of what they did.
 */
function isBlocked(status?: DiaryTierStatus): boolean {
  if (!quests.levelsKnown || !status) return false
  return status.progress !== 'done' && !status.canComplete
}

function summarise(status?: DiaryTierStatus): string {
  if (!status) return ''
  const counted = `${status.doneTasks}/${status.totalTasks} tasks`
  if (status.progress === 'done') return `Complete · ${counted}`
  if (!quests.levelsKnown) return counted
  if (!status.canComplete) {
    const parts: string[] = []
    const skills = status.unmet.unmetSkills.length
    const questsNeeded = status.unmet.unmetQuests.length
    if (skills) parts.push(`${skills} skill${skills === 1 ? '' : 's'}`)
    if (questsNeeded)
      parts.push(`${questsNeeded} quest${questsNeeded === 1 ? '' : 's'}`)
    if (status.unmet.unmetQuestPoints) parts.push('quest points')
    return parts.length ? `${counted} · needs ${parts.join(', ')}` : counted
  }
  return status.blockedTasks
    ? `${counted} · ${status.blockedTasks} blocked`
    : `${counted} · ready`
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="diaries.loading" class="m-0 text-[15px] text-ink-soft">
      Loading diaries…
    </p>

    <template v-else-if="openDiary === null">
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          :disabled="!quests.levelsKnown"
          class="tap pressable bevel-oak px-3 text-[13px] font-bold disabled:opacity-50"
          :class="
            readyOnly
              ? 'bevel-oak-in bg-brown text-gold engraved'
              : 'bg-brown-lt text-parchment-3'
          "
          @click="readyOnly = !readyOnly"
        >
          Ready now
        </button>
        <span class="nums text-[13px] text-ink-soft">
          {{ diaries.completion.tiers }}/{{
            diaries.completion.totalTiers
          }}
          tiers &middot; {{ diaries.completion.tasks }}/{{
            diaries.completion.totalTasks
          }}
          tasks
        </span>
      </div>

      <p v-if="!quests.levelsKnown" class="m-0 text-[13px] text-ink-soft">
        Add your username in Stats to see what you can finish.
      </p>

      <ul class="m-0 flex flex-col gap-1.5 p-0">
        <li v-for="diary in shown" :key="diary.id" class="flex items-stretch">
          <span
            class="w-2 shrink-0"
            :class="
              doneCount(diary.id) === 4
                ? 'bg-done'
                : doneCount(diary.id) > 0
                  ? 'bg-doing'
                  : 'bg-todo'
            "
            aria-hidden="true"
          />
          <button
            type="button"
            class="tap pressable bevel-oak flex min-w-0 flex-1 items-center gap-2 bg-brown-lt py-1.5 pl-3 pr-2 text-left"
            @click="openDiary = diary.id"
          >
            <span class="flex min-w-0 flex-1 flex-col justify-center">
              <span
                class="block truncate text-[15px] font-bold leading-tight text-gold engraved"
              >
                {{ diary.name }}
              </span>
              <span class="block truncate text-[12px] text-parchment-3">
                {{ diary.areas.join(', ') || 'Various areas' }}
              </span>
            </span>
            <span class="nums shrink-0 text-[13px] font-bold text-parchment-3">
              {{ doneCount(diary.id) }}/4
            </span>
            <AppIcon
              name="chevron"
              :size="12"
              class="pointer-events-none shrink-0 text-gold"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="tap pressable bevel-oak flex items-center gap-1 bg-brown-lt px-3 text-[13px] font-bold text-parchment-3 engraved"
          @click="openDiary = null"
        >
          <AppIcon name="back" :size="12" aria-hidden="true" />
          All diaries
        </button>
        <h3 class="m-0 truncate font-display text-[17px] leading-tight">
          {{ openName }}
        </h3>
      </div>

      <p class="m-0 text-[13px] text-ink-soft">
        Rewards are claimed from {{ openTaskmaster || 'the taskmaster' }}. Tasks
        can be done in any order.
      </p>

      <ul class="m-0 flex flex-col gap-2 p-0">
        <li
          v-for="{ tier, status } in openTiers"
          :key="tier.id"
          class="flex items-stretch"
        >
          <span
            class="w-2 shrink-0"
            :class="STRIPE[diaries.progressOf(tier.id)]"
            aria-hidden="true"
          />
          <div
            class="bevel-oak flex min-w-0 flex-1 flex-col gap-1 bg-brown-lt p-2"
          >
            <div class="flex items-center gap-2">
              <span
                class="flex min-w-0 flex-1 items-center gap-1 text-[15px] font-bold text-gold engraved"
              >
                <AppIcon
                  v-if="isBlocked(status)"
                  name="padlock"
                  :size="11"
                  class="shrink-0 text-todo"
                  aria-hidden="true"
                />
                {{ tier.tier }}
              </span>
              <!-- Checks or clears every task in the tier. Written as task
                   completions rather than a tier flag, so there is exactly one
                   record of what's done and this button is visibly the same
                   thing as ticking the boxes below.

                   `checkAll` (a double tick), never `plus`: plus already means
                   "add to queue" on quest rows, and the same glyph cannot mean
                   both that and "mark everything done". The glyph also stays
                   put between states — only the bevel and colour move — so the
                   button keeps saying what it does rather than what has
                   happened. -->
              <button
                type="button"
                :aria-label="
                  diaries.progressOf(tier.id) === 'done'
                    ? `Clear all ${tier.tier} tasks`
                    : `Check all ${tier.tier} tasks`
                "
                class="tap pressable bevel-oak flex w-11 shrink-0 items-center justify-center"
                :class="
                  diaries.progressOf(tier.id) === 'done'
                    ? 'bevel-oak-in bg-brown text-gold'
                    : 'bg-brown-dk text-parchment-3'
                "
                @click="diaries.toggleTier(tier.id)"
              >
                <AppIcon name="checkAll" :size="18" />
              </button>
            </div>

            <span class="nums text-[12px] text-parchment-3">
              {{ summarise(status) }}
            </span>

            <!-- The claim gate, stated separately from eligibility: the tasks
                 are doable in any order, only the reward waits. Folding these
                 together would hide a tier worth working on. -->
            <span
              v-if="status?.rewardsBlockedBy.length"
              class="text-[12px] text-parchment-3/80"
            >
              Rewards need {{ status.rewardsBlockedBy.join(', ') }} first.
            </span>

            <ul class="m-0 flex flex-col gap-0.5 p-0 pt-1">
              <li v-for="(task, i) in tier.tasks" :key="task.id">
                <!-- The whole row is the target — `.tap` puts a 44px floor
                     under it — but the box still has to *look* like something
                     worth aiming at, so it is 24px rather than the 16px that
                     matched the old text size. An affordance the thumb can't
                     see is one the thumb won't trust, whatever the hit area
                     actually is.

                     Text is 15px, the same as a quest row's title, not the
                     13px used for secondary lines elsewhere: this is the
                     content of the panel, read while playing, not a caption
                     under something else. -->
                <button
                  type="button"
                  class="tap pressable flex w-full items-start gap-2 px-1 py-1.5 text-left text-[15px] leading-snug"
                  :class="
                    !status?.tasks[i]?.done &&
                    quests.levelsKnown &&
                    status?.tasks[i]?.canComplete === false
                      ? 'text-parchment-3/60'
                      : 'text-parchment-2'
                  "
                  @click="diaries.toggleTask(task.id)"
                >
                  <span
                    class="bevel-oak flex h-6 w-6 shrink-0 items-center justify-center"
                    :class="
                      status?.tasks[i]?.done
                        ? 'bevel-oak-in bg-brown text-gold'
                        : 'bg-brown-dk'
                    "
                    aria-hidden="true"
                  >
                    <AppIcon
                      v-if="status?.tasks[i]?.done"
                      name="check"
                      :size="14"
                    />
                  </span>

                  <!-- Shown even on a checked task. The padlock is the wiki's
                       opinion of the requirements; the check is the player's
                       record of what they did. Neither overrides the other. -->
                  <AppIcon
                    v-if="
                      quests.levelsKnown &&
                      status?.tasks[i]?.canComplete === false
                    "
                    name="padlock"
                    :size="12"
                    class="mt-1 shrink-0 text-todo"
                    aria-hidden="true"
                  />

                  <span class="nums shrink-0 opacity-60">{{ i + 1 }}.</span>
                  <span
                    class="min-w-0 flex-1"
                    :class="{
                      'line-through decoration-1': status?.tasks[i]?.done,
                    }"
                  >
                    {{ task.text }}
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
