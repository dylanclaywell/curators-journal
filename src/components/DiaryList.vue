<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useDiariesStore } from '@/stores/diaries'
import { useQuestsStore } from '@/stores/quests'
import type { QuestProgress } from '@/lib/quests'
import { DIARY_TIERS } from '@/lib/types'

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

const STRIPE: Record<QuestProgress, string> = {
  todo: 'bg-todo',
  doing: 'bg-doing',
  done: 'bg-done',
}

function tierOf(diaryId: string, tier: string) {
  return diaries.index.byId.get(diaryId)?.tiers.find((t) => t.tier === tier)
}

function statusOf(id: string) {
  return diaries.statuses.get(id)
}

/** Tiers done, out of four — the number that reads at a glance in a list row. */
function doneCount(diaryId: string): number {
  const diary = diaries.index.byId.get(diaryId)
  if (!diary) return 0
  return diary.tiers.filter((t) => diaries.progressOf(t.id) === 'done').length
}

/**
 * Blocked means "requirements unmet", and only for a tier not yet done —
 * matching the Quests panel's rule, where `canStart` stops being
 * decision-relevant once a quest is underway.
 */
function isBlocked(id: string): boolean {
  if (!quests.levelsKnown) return false
  const s = statusOf(id)
  return Boolean(s && s.progress !== 'done' && !s.canComplete)
}

function summarise(id: string): string {
  const s = statusOf(id)
  if (!s) return ''
  if (s.progress === 'done') return 'Complete'
  if (!quests.levelsKnown) return `${s.tasks.length} tasks`
  if (!s.canComplete) {
    const skills = s.unmet.unmetSkills.length
    const quests_ = s.unmet.unmetQuests.length
    const parts: string[] = []
    if (skills) parts.push(`${skills} skill${skills === 1 ? '' : 's'}`)
    if (quests_) parts.push(`${quests_} quest${quests_ === 1 ? '' : 's'}`)
    if (s.unmet.unmetQuestPoints) parts.push('quest points')
    return parts.length ? `Needs ${parts.join(', ')}` : 'Blocked'
  }
  return s.blockedTasks
    ? `Ready · ${s.blockedTasks} of ${s.tasks.length} tasks blocked`
    : `Ready · ${s.tasks.length} tasks`
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
          {{ diaries.completion.done }} of {{ diaries.completion.total }} tiers
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
          {{ diaries.index.byId.get(openDiary)?.name }}
        </h3>
      </div>

      <p class="m-0 text-[13px] text-ink-soft">
        Rewards are claimed from
        {{ diaries.index.byId.get(openDiary)?.taskmaster || 'the taskmaster' }}.
        Tasks can be done in any order.
      </p>

      <ul class="m-0 flex flex-col gap-2 p-0">
        <li v-for="name in DIARY_TIERS" :key="name" class="flex items-stretch">
          <span
            class="w-2 shrink-0"
            :class="
              STRIPE[diaries.progressOf(tierOf(openDiary, name)?.id ?? '')]
            "
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
                  v-if="isBlocked(tierOf(openDiary, name)?.id ?? '')"
                  name="padlock"
                  :size="11"
                  class="shrink-0 text-todo"
                  aria-hidden="true"
                />
                {{ name }}
              </span>
              <!-- Cycles todo → doing → done, as quest rows do. This is the
                   only write path for diary progress, so it carries the
                   whole hand-entry burden — 48 taps for a full account. -->
              <button
                type="button"
                :aria-label="`Mark ${name} tier`"
                class="tap pressable bevel-oak flex w-11 shrink-0 items-center justify-center"
                :class="
                  diaries.progressOf(tierOf(openDiary, name)?.id ?? '') ===
                  'done'
                    ? 'bevel-oak-in bg-brown text-gold'
                    : 'bg-brown-dk text-parchment-3'
                "
                @click="
                  diaries.cycleProgress(tierOf(openDiary, name)?.id ?? '')
                "
              >
                <AppIcon
                  :name="
                    diaries.progressOf(tierOf(openDiary, name)?.id ?? '') ===
                    'done'
                      ? 'check'
                      : 'plus'
                  "
                  :size="16"
                />
              </button>
            </div>

            <span class="text-[12px] text-parchment-3">
              {{ summarise(tierOf(openDiary, name)?.id ?? '') }}
            </span>

            <!-- The claim gate, stated separately from eligibility: the tasks
                 are doable in any order, only the reward waits. Folding these
                 together would hide a tier worth working on. -->
            <span
              v-if="
                statusOf(tierOf(openDiary, name)?.id ?? '')?.rewardsBlockedBy
                  ?.length
              "
              class="text-[12px] text-parchment-3/80"
            >
              Rewards need
              {{
                statusOf(
                  tierOf(openDiary, name)?.id ?? '',
                )?.rewardsBlockedBy.join(', ')
              }}
              first.
            </span>

            <ul class="m-0 flex flex-col gap-1 p-0 pt-1">
              <li
                v-for="(t, i) in tierOf(openDiary, name)?.tasks ?? []"
                :key="i"
                class="flex items-start gap-1.5 text-[13px] leading-snug"
                :class="
                  statusOf(tierOf(openDiary, name)?.id ?? '')?.tasks[i]
                    ?.canComplete === false && quests.levelsKnown
                    ? 'text-parchment-3/60'
                    : 'text-parchment-2'
                "
              >
                <AppIcon
                  v-if="
                    quests.levelsKnown &&
                    statusOf(tierOf(openDiary, name)?.id ?? '')?.tasks[i]
                      ?.canComplete === false
                  "
                  name="padlock"
                  :size="10"
                  class="mt-1 shrink-0 text-todo"
                  aria-hidden="true"
                />
                <span class="nums shrink-0 opacity-60">{{ i + 1 }}.</span>
                <span class="min-w-0 flex-1">{{ t.text }}</span>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
