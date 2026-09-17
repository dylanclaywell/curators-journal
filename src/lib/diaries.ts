/**
 * Achievement diary eligibility.
 *
 * Pure, like `quests.ts`, and for the same reason — it lives in `src/lib` and
 * is compiled by both tsconfig projects.
 *
 * Almost everything here delegates to `evaluateRequirements`, because a diary
 * tier states the same things a quest does. What is genuinely different is
 * worth stating plainly:
 *
 *   - **There is no start/finish split.** A quest can be started and not
 *     finished; a diary task is done or it isn't. So this module reports
 *     `canComplete` and never `canStart`, and `requiredToStart` is `null`
 *     throughout the dataset rather than carrying meaning.
 *   - **Tiers are not prerequisites of each other.** Tasks may be done in any
 *     order; only claiming a tier's *rewards* requires the tiers below it. So
 *     a Hard tier whose requirements are met is completable even with Easy
 *     untouched, and `rewardsBlockedBy` reports the claim gate separately
 *     rather than folding it into eligibility.
 *   - **Tasks carry their own requirements**, so a blocked tier can say which
 *     task blocks it. That is the whole reason the dataset stores them.
 *
 * Diaries never enter `buildPlan`: nothing in the quest graph depends on one,
 * so they order nothing.
 */
import { DIARY_TIERS } from './types'
import type { Diary, DiaryTask, DiaryTier, DiaryTierName } from './types'
import { evaluateRequirements, progressOf } from './quests'
import type {
  PlayerState,
  ProgressMap,
  QuestIndex,
  QuestProgress,
  UnmetRequirements,
} from './quests'

/**
 * Tier id -> progress, in the same three states quests use.
 *
 * Reusing `QuestProgress` is deliberate rather than lazy: `doing` means some
 * tasks are done, which is real for a tier, and it keeps diary progress on the
 * sync pipe's monotonic merge without a second set of rules. See ROADMAP.md on
 * why every passenger on that pipe has to be monotonic.
 */
export type DiaryProgressMap = ProgressMap

export interface DiaryTaskStatus {
  /** Position within the tier, 0-based. Task text lives in the dataset. */
  index: number
  /** Nothing unmet: the task is doable as things stand. */
  canComplete: boolean
  unmet: UnmetRequirements
  /** Requirements no program can check, carried straight from the dataset. */
  notes: string[]
}

export interface DiaryTierStatus {
  id: string
  diaryId: string
  tier: DiaryTierName
  progress: QuestProgress
  /** Nothing unmet in the tier's own stated requirements. */
  canComplete: boolean
  unmet: UnmetRequirements
  tasks: DiaryTaskStatus[]
  /**
   * How many tasks are individually blocked. A tier can clear its own stated
   * requirements while a task inside it does not — the wiki maintains the two
   * by hand — so this is the honest number to show next to "ready".
   */
  blockedTasks: number
  notes: string[]
  /**
   * Tiers below this one that are not yet done. Empty means the rewards are
   * claimable once the tasks are. Not part of `canComplete`: the tasks are
   * doable regardless, and conflating the two would hide a tier the player
   * could be working on.
   */
  rewardsBlockedBy: DiaryTierName[]
}

export interface DiaryIndex {
  byId: ReadonlyMap<string, Diary>
  /** Tier id -> its diary and tier, so a route param resolves in one lookup. */
  tierById: ReadonlyMap<string, { diary: Diary; tier: DiaryTier }>
  all: readonly Diary[]
}

export function buildDiaryIndex(diaries: readonly Diary[]): DiaryIndex {
  const tierById = new Map<string, { diary: Diary; tier: DiaryTier }>()
  for (const diary of diaries) {
    for (const tier of diary.tiers) tierById.set(tier.id, { diary, tier })
  }
  return {
    byId: new Map(diaries.map((d) => [d.id, d])),
    tierById,
    all: diaries,
  }
}

function nothingUnmet(unmet: UnmetRequirements): boolean {
  return (
    !unmet.unmetSkills.length &&
    !unmet.unmetQuests.length &&
    !unmet.unmetQuestPoints &&
    !unmet.unmetCombatLevel
  )
}

export function evaluateDiaryTask(
  task: DiaryTask,
  index: number,
  state: PlayerState,
  quests: QuestIndex,
): DiaryTaskStatus {
  const unmet = evaluateRequirements(task.requirements, state, quests)
  return {
    index,
    canComplete: nothingUnmet(unmet),
    unmet,
    notes: task.notes,
  }
}

/**
 * Evaluates one tier, and every task inside it, against the player.
 *
 * `diaryProgress` is separate from `state.progress` because the two are
 * different keyspaces — tier ids and quest ids — and merging them into one map
 * would let a diary id collide with a quest id. The quest progress inside
 * `state` is still needed: diary tiers have quest prerequisites.
 */
export function evaluateDiaryTier(
  diary: Diary,
  tier: DiaryTier,
  state: PlayerState,
  quests: QuestIndex,
  diaryProgress: DiaryProgressMap,
): DiaryTierStatus {
  const unmet = evaluateRequirements(tier.requirements, state, quests)
  const tasks = tier.tasks.map((task, i) =>
    evaluateDiaryTask(task, i, state, quests),
  )

  const below = DIARY_TIERS.slice(0, DIARY_TIERS.indexOf(tier.tier))
  const rewardsBlockedBy = below.filter((name) => {
    const other = diary.tiers.find((t) => t.tier === name)
    return other ? progressOf(other.id, diaryProgress) !== 'done' : false
  })

  return {
    id: tier.id,
    diaryId: diary.id,
    tier: tier.tier,
    progress: progressOf(tier.id, diaryProgress),
    canComplete: nothingUnmet(unmet),
    unmet,
    tasks,
    blockedTasks: tasks.filter((t) => !t.canComplete).length,
    notes: tier.notes,
    rewardsBlockedBy,
  }
}

export function evaluateDiary(
  diary: Diary,
  state: PlayerState,
  quests: QuestIndex,
  diaryProgress: DiaryProgressMap,
): DiaryTierStatus[] {
  return diary.tiers.map((tier) =>
    evaluateDiaryTier(diary, tier, state, quests, diaryProgress),
  )
}

/**
 * Tiers the player could complete now: requirements met, not already done.
 *
 * The diary equivalent of `startableNow`. Unlike quests there is no ordering
 * to respect, so this is a filter rather than a plan.
 */
export function completableNow(
  index: DiaryIndex,
  state: PlayerState,
  quests: QuestIndex,
  diaryProgress: DiaryProgressMap,
): DiaryTierStatus[] {
  const out: DiaryTierStatus[] = []
  for (const diary of index.all) {
    for (const tier of diary.tiers) {
      const status = evaluateDiaryTier(
        diary,
        tier,
        state,
        quests,
        diaryProgress,
      )
      if (status.canComplete && status.progress !== 'done') out.push(status)
    }
  }
  return out
}

/** Completed tiers over total, for a progress readout. */
export function diaryCompletion(
  index: DiaryIndex,
  diaryProgress: DiaryProgressMap,
): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const diary of index.all) {
    for (const tier of diary.tiers) {
      total++
      if (progressOf(tier.id, diaryProgress) === 'done') done++
    }
  }
  return { done, total }
}
