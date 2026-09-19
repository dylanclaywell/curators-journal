/**
 * Achievement diary eligibility and progress.
 *
 * Pure, like `quests.ts`, and for the same reason — it lives in `src/lib` and
 * is compiled by both tsconfig projects.
 *
 * Most of the requirement checking delegates to `evaluateRequirements`,
 * because a diary tier states the same things a quest does. What is genuinely
 * different is worth stating plainly:
 *
 *   - **There is no start/finish split.** A quest can be started and not
 *     finished; a diary task is done or it isn't. So this module reports
 *     `canComplete` and never `canStart`, and `requiredToStart` is `null`
 *     throughout the dataset rather than carrying meaning.
 *   - **The task is the unit of progress, and the tier's state is derived from
 *     it.** There is one hand-entered fact — this task is done — and
 *     everything else is computed. Tier progress used to be entered
 *     separately, which meant two records that could disagree and a control
 *     whose effect nobody could name.
 *   - **Done and doable are independent.** A task can be checked while its
 *     requirements read as unmet: the dataset's levels are the wiki's opinion
 *     and the check is the player's record of what they actually did. The app
 *     shows both and never argues with the player about their own history.
 *   - **Tiers are not prerequisites of each other.** Tasks may be done in any
 *     order; only claiming a tier's *rewards* requires the tiers below it, so
 *     `rewardsBlockedBy` reports the claim gate separately from eligibility.
 *
 * Diaries never enter `buildPlan`: nothing in the quest graph depends on one,
 * so they order nothing.
 */
import { DIARY_TIERS } from './types'
import type { Diary, DiaryTask, DiaryTier, DiaryTierName } from './types'
import { evaluateRequirements } from './quests'
import type {
  PlayerState,
  QuestIndex,
  QuestProgress,
  UnmetRequirements,
} from './quests'

/**
 * Task id -> done. Only completed tasks are present, so absence is "not done"
 * and the stored object stays proportional to what the player has actually
 * finished rather than to the size of the dataset.
 *
 * Keyed by the content-derived ids in `task-id.ts`, which is what lets a
 * completion survive the dataset being regenerated.
 */
export type DiaryTaskMap = Readonly<Record<string, true>>

export interface DiaryTaskStatus {
  id: string
  /** Position within the tier, 0-based, for the numbering the wiki uses. */
  index: number
  /** The player's own record. Independent of `canComplete`. */
  done: boolean
  /** Nothing unmet: the requirements say this is doable as things stand. */
  canComplete: boolean
  unmet: UnmetRequirements
  /** Requirements no program can check, carried straight from the dataset. */
  notes: string[]
}

export interface DiaryTierStatus {
  id: string
  diaryId: string
  tier: DiaryTierName
  /** Derived from the tasks: all done, some done, or none. */
  progress: QuestProgress
  doneTasks: number
  totalTasks: number
  /** Nothing unmet in the tier's own stated requirements. */
  canComplete: boolean
  unmet: UnmetRequirements
  tasks: DiaryTaskStatus[]
  /**
   * How many *unfinished* tasks are individually blocked. A tier can clear its
   * own stated requirements while a task inside it does not — the wiki
   * maintains the two by hand — so this is the honest number to show next to
   * "ready". Tasks already done are excluded: what the player has finished is
   * not work remaining, whatever the requirements claim.
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

/**
 * A tier's state, from its tasks alone.
 *
 * A tier with no tasks reads as `todo` rather than `done`: an empty tier means
 * the dataset failed to parse one, and reporting that as complete would be the
 * worst possible answer.
 */
export function tierProgressFrom(
  tier: DiaryTier,
  done: DiaryTaskMap,
): QuestProgress {
  if (!tier.tasks.length) return 'todo'
  const count = tier.tasks.filter((t) => done[t.id]).length
  if (count === 0) return 'todo'
  return count === tier.tasks.length ? 'done' : 'doing'
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
  done: DiaryTaskMap,
): DiaryTaskStatus {
  const unmet = evaluateRequirements(task.requirements, state, quests)
  return {
    id: task.id,
    index,
    done: Boolean(done[task.id]),
    canComplete: nothingUnmet(unmet),
    unmet,
    notes: task.notes,
  }
}

/**
 * Evaluates one tier, and every task inside it, against the player.
 *
 * `done` is separate from `state.progress` because the two are different
 * keyspaces — task ids and quest ids — and merging them would let one collide
 * with the other. The quest progress inside `state` is still needed: diary
 * tiers and tasks have quest prerequisites.
 */
export function evaluateDiaryTier(
  diary: Diary,
  tier: DiaryTier,
  state: PlayerState,
  quests: QuestIndex,
  done: DiaryTaskMap,
): DiaryTierStatus {
  const unmet = evaluateRequirements(tier.requirements, state, quests)
  const tasks = tier.tasks.map((task, i) =>
    evaluateDiaryTask(task, i, state, quests, done),
  )

  const below = DIARY_TIERS.slice(0, DIARY_TIERS.indexOf(tier.tier))
  const rewardsBlockedBy = below.filter((name) => {
    const other = diary.tiers.find((t) => t.tier === name)
    return other ? tierProgressFrom(other, done) !== 'done' : false
  })

  return {
    id: tier.id,
    diaryId: diary.id,
    tier: tier.tier,
    progress: tierProgressFrom(tier, done),
    doneTasks: tasks.filter((t) => t.done).length,
    totalTasks: tasks.length,
    canComplete: nothingUnmet(unmet),
    unmet,
    tasks,
    blockedTasks: tasks.filter((t) => !t.done && !t.canComplete).length,
    notes: tier.notes,
    rewardsBlockedBy,
  }
}

export function evaluateDiary(
  diary: Diary,
  state: PlayerState,
  quests: QuestIndex,
  done: DiaryTaskMap,
): DiaryTierStatus[] {
  return diary.tiers.map((tier) =>
    evaluateDiaryTier(diary, tier, state, quests, done),
  )
}

/**
 * Tiers the player could finish now: requirements met, not already done.
 *
 * The diary equivalent of `startableNow`. Unlike quests there is no ordering
 * to respect, so this is a filter rather than a plan.
 */
export function completableNow(
  index: DiaryIndex,
  state: PlayerState,
  quests: QuestIndex,
  done: DiaryTaskMap,
): DiaryTierStatus[] {
  const out: DiaryTierStatus[] = []
  for (const diary of index.all) {
    for (const tier of diary.tiers) {
      const status = evaluateDiaryTier(diary, tier, state, quests, done)
      if (status.canComplete && status.progress !== 'done') out.push(status)
    }
  }
  return out
}

/**
 * The tasks a set of completed tiers implies.
 *
 * The plugin can say a tier is done and nothing about its tasks, but the
 * player's record and every derived value here is per task. Expanding is what
 * lets one shape carry both without a second, tier-level record that could
 * disagree with the first. Ids the dataset doesn't know contribute nothing.
 */
export function expandTiers(
  index: DiaryIndex,
  tierIds: readonly string[],
): DiaryTaskMap {
  const out: Record<string, true> = {}
  for (const id of tierIds) {
    const entry = index.tierById.get(id)
    if (!entry) continue
    for (const taskId of taskIdsOf(entry.tier)) out[taskId] = true
  }
  return out
}

/**
 * The player's task completions with the synced ones added.
 *
 * Union, so it can only ever add: the same property `mergeProgress` has for
 * quests, and for the same reason — it is what makes switching the merge off a
 * complete undo. Not persisted; the store computes it on read.
 */
export function mergeDoneTasks(
  local: DiaryTaskMap,
  synced: DiaryTaskMap,
): DiaryTaskMap {
  return { ...local, ...synced }
}

/** Completed tiers and tasks over their totals, for a progress readout. */
export function diaryCompletion(
  index: DiaryIndex,
  done: DiaryTaskMap,
): { tiers: number; totalTiers: number; tasks: number; totalTasks: number } {
  let tiers = 0
  let totalTiers = 0
  let tasks = 0
  let totalTasks = 0
  for (const diary of index.all) {
    for (const tier of diary.tiers) {
      totalTiers++
      totalTasks += tier.tasks.length
      const count = tier.tasks.filter((t) => done[t.id]).length
      tasks += count
      if (tier.tasks.length && count === tier.tasks.length) tiers++
    }
  }
  return { tiers, totalTiers, tasks, totalTasks }
}

/** Every task id in a tier — what "check the whole tier" writes. */
export function taskIdsOf(tier: DiaryTier): string[] {
  return tier.tasks.map((t) => t.id)
}
