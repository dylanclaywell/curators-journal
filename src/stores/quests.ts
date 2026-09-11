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
import { useHiscoresStore } from './hiscores'
import { useSettingsStore } from './settings'
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

  /** Quests the player chose. Order is theirs; the plan derives its own. */
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

  const playerState = computed<PlayerState>(() => ({
    levels: levels.value,
    progress: progress.value as ProgressMap,
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

  function progressOf(id: string): QuestProgress {
    return progress.value[id] ?? 'todo'
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
    setProgress(id, next[progressOf(id)])
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
    questPointsEarned(index.value, progress.value as ProgressMap),
  )

  const completedCount = computed(
    () => Object.values(progress.value).filter((s) => s === 'done').length,
  )

  return {
    dataset,
    loading,
    hydrated,
    progress,
    goals,
    index,
    levels,
    statuses,
    plan,
    questPoints,
    completedCount,
    ensureDataset,
    ensureReady,
    levelsKnown,
    awaitingLevels,
    progressOf,
    setProgress,
    cycleProgress,
    isGoal,
    addGoal,
    removeGoal,
    toggleGoal,
  }
})
