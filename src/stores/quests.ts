import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  buildIndex,
  buildPlan,
  evaluateQuest,
  questPointsEarned,
  type PlayerState,
  type ProgressMap,
  type QuestProgress,
  type QuestStatus,
  type SkillLevels,
} from '@/lib/quests'
import type { Quest, QuestDataset } from '@/lib/types'
import { mergeProgress, reconcileSnapshot } from '@/lib/sync'
import { useHiscoresStore } from './hiscores'
import { useSettingsStore } from './settings'
import { useSyncStore } from './sync'
import { read, write } from './persist'

/**
 * The two halves of the quest half, kept apart on purpose.
 *
 *   - The **dataset** is generated, committed and disposable. If it vanished it
 *     would come back on the next load at no cost.
 *   - **Progress and goals** are hand-entered, authoritative and
 *     unrecoverable. Nothing else in the app has that property.
 *
 * They are persisted under separate keys and never written together, so
 * regenerating the dataset can't touch what the player typed. That separation
 * is the reason CLAUDE.md keeps insisting these are two kinds of data.
 */
const PROGRESS_KEY = 'quests:progress'
const GOALS_KEY = 'quests:goals'

export const useQuestsStore = defineStore('quests', () => {
  const dataset = ref<QuestDataset | null>(null)
  const loading = ref(false)

  /**
   * Only non-default states are stored, so `todo` is the absence of an entry.
   * Keeps the persisted object proportional to what the player has actually
   * done rather than to the size of the dataset, and keeps an export readable.
   */
  const progress = ref<Record<string, QuestProgress>>({})

  /**
   * Quests the player chose, in the order they want them. `buildPlan` walks
   * goals in this order, so the array's sequence is a real setting rather than
   * insertion trivia — it's how priority between independent chains is
   * expressed, and it's in the export for that reason.
   */
  const goals = ref<string[]>([])

  /**
   * False until the persisted values have loaded. Writes are gated on it, or
   * the empty initial state would overwrite real data during startup — the
   * same hazard the settings store guards against.
   */
  const hydrated = ref(false)

  const index = computed(() =>
    buildIndex(dataset.value?.quests ?? ([] as readonly Quest[])),
  )

  /**
   * Levels come from the hiscores store, which is fetched and read-only. This
   * store never writes them, and treats an absent level as unknown rather than
   * as zero — see `evaluateQuest`.
   */
  const levels = computed<SkillLevels>(() => {
    const snapshot = useHiscoresStore().snapshot
    if (!snapshot) return {}
    const out: SkillLevels = {}
    for (const skill of snapshot.skills) out[skill.name] = skill.level
    return out
  })

  /**
   * The RuneLite snapshot, reduced to quests this build knows about.
   *
   * Empty unless the player turned the merge on, so the toggle is the only
   * thing standing between synced data and every derived value below.
   */
  const syncedProgress = computed<ProgressMap>(() => {
    const sync = useSyncStore()
    if (!sync.mergeEnabled || !sync.snapshot) return {}
    return reconcileSnapshot(sync.snapshot, new Set(index.value.byId.keys()))
      .progress
  })

  /**
   * Ids the snapshot carried that this dataset has no quest for. Expected to
   * be empty; anything here means the plugin's quest names and
   * `build:quests` have drifted, which is worth showing rather than hiding.
   */
  const syncUnknownIds = computed<string[]>(() => {
    const sync = useSyncStore()
    if (!sync.snapshot) return []
    return reconcileSnapshot(sync.snapshot, new Set(index.value.byId.keys()))
      .unknownIds
  })

  /**
   * What the app displays and reasons about: the player's own record, with the
   * snapshot allowed to move a quest forwards and never backwards.
   *
   * **This is a computed and nothing persists it.** `quests:progress` is
   * written only by `setProgress`, so a bad snapshot cannot reach disk and
   * turning the merge off restores exactly what the player entered. That
   * property is the entire safety argument for syncing at all — see
   * ROADMAP.md Phase 5.
   */
  const effectiveProgress = computed<ProgressMap>(() =>
    mergeProgress(progress.value as ProgressMap, syncedProgress.value),
  )

  const playerState = computed<PlayerState>(() => ({
    levels: levels.value,
    progress: effectiveProgress.value,
  }))

  /**
   * Loads the committed dataset.
   *
   * Dynamically imported so its ~106 KB lands in a chunk of its own rather
   * than the initial bundle — the app must open on a phone over a bad
   * connection, and the quest panels are lazy for the same reason.
   *
   * Idempotent: every panel that needs quests can call it on mount.
   */
  async function ensureDataset(): Promise<void> {
    if (dataset.value || loading.value) return
    loading.value = true
    try {
      const module = await import('@/data/quests.json')
      dataset.value = module.default as QuestDataset
    } finally {
      loading.value = false
    }
  }

  /**
   * Everything a quest panel needs to be useful: the dataset, and levels.
   *
   * Both in one call so views don't have to know that eligibility depends on
   * two independent sources — and so no panel repeats the bug where levels
   * were only present if Stats had been visited first.
   */
  async function ensureReady(): Promise<void> {
    await Promise.all([ensureDataset(), useHiscoresStore().ensureLoaded()])
  }

  /** True once we have levels to evaluate against, rather than assuming any. */
  const levelsKnown = computed(() => Object.keys(levels.value).length > 0)

  /**
   * Distinguishes "no account configured" from "levels on the way". Without
   * this the panel told the player to set a username they had already set,
   * for as long as the lookup took.
   */
  const awaitingLevels = computed(() => {
    if (levelsKnown.value) return false
    const settings = useSettingsStore()
    return !settings.hydrated || Boolean(settings.username)
  })

  async function hydrate(): Promise<void> {
    const [savedProgress, savedGoals] = await Promise.all([
      read<Record<string, QuestProgress>>(PROGRESS_KEY),
      read<string[]>(GOALS_KEY),
    ])
    if (savedProgress) progress.value = savedProgress
    if (savedGoals) goals.value = savedGoals
    hydrated.value = true
  }

  watch(
    [progress, goals],
    () => {
      if (!hydrated.value) return
      void write(PROGRESS_KEY, progress.value)
      void write(GOALS_KEY, goals.value)
    },
    { deep: true },
  )

  void hydrate()

  /**
   * What to show for a quest: the merged state, so a synced completion reads
   * as done everywhere without every view having to know sync exists.
   */
  function progressOf(id: string): QuestProgress {
    return effectiveProgress.value[id] ?? 'todo'
  }

  /** What the player actually entered, which is what the write paths cycle. */
  function localProgressOf(id: string): QuestProgress {
    return progress.value[id] ?? 'todo'
  }

  /**
   * True when a quest reads as further along than the player recorded — that
   * is, the snapshot is what's showing.
   *
   * The UI needs this: tapping through `cycleProgress` on such a quest edits
   * the local value underneath and the display doesn't move, because the merge
   * re-asserts it. Better to show where the state came from than to offer a
   * control that appears not to work.
   */
  function isSynced(id: string): boolean {
    return progressOf(id) !== localProgressOf(id)
  }

  function setProgress(id: string, state: QuestProgress): void {
    if (state === 'todo') {
      // Delete rather than store the default, so the object stays a record of
      // what was done rather than a row per quest.
      const rest = { ...progress.value }
      delete rest[id]
      progress.value = rest
      return
    }
    progress.value = { ...progress.value, [id]: state }
  }

  /**
   * Cycles todo → doing → done → todo. Lives here rather than on a Quests
   * panel row: marking progress belongs in quest detail (4d), which has room
   * to show why a quest is blocked or startable — the row tap in the list is
   * reserved for opening that detail, not for a whole-quest toggle.
   */
  function cycleProgress(id: string): void {
    const next: Record<QuestProgress, QuestProgress> = {
      todo: 'doing',
      doing: 'done',
      done: 'todo',
    }
    setProgress(id, next[localProgressOf(id)])
  }

  function isGoal(id: string): boolean {
    return goals.value.includes(id)
  }

  function addGoal(id: string): void {
    if (!goals.value.includes(id)) goals.value = [...goals.value, id]
  }

  function removeGoal(id: string): void {
    goals.value = goals.value.filter((goal) => goal !== id)
  }

  /**
   * Swaps a goal with its neighbour in the given direction. `buildPlan` walks
   * goals in this order (since 4e), so this is a real setting, not cosmetic —
   * moving a goal up can reorder the whole plan behind it.
   *
   * A no-op past either end, so callers don't need to compute bounds just to
   * disable a button.
   */
  function moveGoal(id: string, direction: 'up' | 'down'): void {
    const i = goals.value.indexOf(id)
    if (i === -1) return
    const j = direction === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= goals.value.length) return
    const next = [...goals.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    goals.value = next
  }

  function toggleGoal(id: string): void {
    if (isGoal(id)) removeGoal(id)
    else addGoal(id)
  }

  /** Every quest's status against current levels and progress. */
  const statuses = computed<Map<string, QuestStatus>>(() => {
    const map = new Map<string, QuestStatus>()
    for (const quest of index.value.all) {
      map.set(quest.id, evaluateQuest(quest, playerState.value, index.value))
    }
    return map
  })

  /** The ordered plan for the chosen goals, prerequisites expanded. */
  const plan = computed(() =>
    buildPlan(goals.value, playerState.value, index.value),
  )

  const questPoints = computed(() =>
    questPointsEarned(index.value, effectiveProgress.value),
  )

  const completedCount = computed(
    () =>
      Object.values(effectiveProgress.value).filter((s) => s === 'done').length,
  )

  return {
    dataset,
    loading,
    hydrated,
    progress,
    effectiveProgress,
    syncedProgress,
    syncUnknownIds,
    goals,
    index,
    levels,
    // Exposed for the diaries store: a diary tier gates on quest completions
    // and quest points, so it needs the same merged view this store already
    // derives rather than assembling a second, subtly different one.
    playerState,
    statuses,
    plan,
    questPoints,
    completedCount,
    ensureDataset,
    ensureReady,
    levelsKnown,
    awaitingLevels,
    progressOf,
    localProgressOf,
    isSynced,
    setProgress,
    cycleProgress,
    isGoal,
    addGoal,
    removeGoal,
    moveGoal,
    toggleGoal,
  }
})
