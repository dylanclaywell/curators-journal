import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  buildDiaryIndex,
  completableNow,
  diaryCompletion,
  evaluateDiaryTier,
  expandTiers,
  mergeDoneTasks,
  taskIdsOf,
  tierProgressFrom,
} from '@/lib/diaries'
import type { DiaryTaskMap, DiaryTierStatus } from '@/lib/diaries'
import type { Diary, DiaryDataset } from '@/lib/types'
import type { QuestProgress } from '@/lib/quests'
import { reconcileTiers } from '@/lib/sync'
import { useQuestsStore } from './quests'
import { useSyncStore } from './sync'
import { read, write } from './persist'

/**
 * Achievement diaries, in the same two halves the quest store keeps apart:
 * a generated, disposable dataset, and hand-entered progress that has no
 * other source.
 *
 * **There is exactly one hand-entered fact here: a task is done.** Tier state,
 * counts and the reward gate are all derived from that. An earlier version
 * stored tier progress separately and it was the wrong shape twice over — two
 * records that could disagree, and a tier control whose effect nobody could
 * name. Marking a tier now simply checks its tasks, which is visibly the same
 * thing.
 *
 * Task ids are content-derived (`task-id.ts`) so a completion survives the
 * dataset being regenerated, and they are a different keyspace from quest ids,
 * which is why they get their own storage key rather than sharing one map.
 *
 * It leans on the quest store rather than duplicating it: tiers and tasks gate
 * on quest completions and quest points, so `ensureReady` pulls both. No panel
 * can depend on Quests having been visited first — the bug CLAUDE.md records
 * for levels, which would land here the same way.
 */
const TASKS_KEY = 'diaries:tasks'

export const useDiariesStore = defineStore('diaries', () => {
  const dataset = ref<DiaryDataset | null>(null)
  const loading = ref(false)

  /** Only completed tasks are stored; absence is "not done". */
  const doneTasks = ref<Record<string, true>>({})

  /** False until the persisted values load. Writes are gated on it. */
  const hydrated = ref(false)

  const index = computed(() =>
    buildDiaryIndex(dataset.value?.diaries ?? ([] as readonly Diary[])),
  )

  /**
   * Its own chunk, like `quests.json`.
   *
   * ROADMAP.md asked for this from the start rather than as a later fix:
   * `quests.json` is already the largest asset by a wide margin, and a static
   * import here would add another quarter of a megabyte to whatever chunk
   * touched it.
   */
  async function ensureDataset(): Promise<void> {
    if (dataset.value || loading.value) return
    loading.value = true
    try {
      const module = await import('@/data/diaries.json')
      dataset.value = module.default as unknown as DiaryDataset
    } finally {
      loading.value = false
    }
  }

  /**
   * Everything a diary panel needs: this dataset, plus the quest store, since
   * tiers gate on quests and quest points.
   */
  async function ensureReady(): Promise<void> {
    await Promise.all([ensureDataset(), useQuestsStore().ensureReady()])
  }

  async function hydrate(): Promise<void> {
    const saved = await read<Record<string, true>>(TASKS_KEY)
    if (saved) doneTasks.value = saved
    hydrated.value = true
  }

  watch(
    doneTasks,
    () => {
      if (!hydrated.value) return
      void write(TASKS_KEY, doneTasks.value)
    },
    { deep: true },
  )

  void hydrate()

  /**
   * Tiers the RuneLite snapshot reports complete, reduced to ones this build
   * knows about.
   *
   * Empty unless the player turned the merge on, so the toggle is the only
   * thing standing between synced data and every derived value below. Tier
   * granularity is all the game exposes — there is nothing per task to sync.
   */
  const syncedTiers = computed<string[]>(() => {
    const sync = useSyncStore()
    if (!sync.mergeEnabled || !sync.snapshot) return []
    return reconcileTiers(sync.snapshot, new Set(index.value.tierById.keys()))
      .tiers
  })

  /**
   * Tier ids the snapshot carried that this dataset has no tier for. Expected
   * to be empty; anything here means the plugin's tier ids and `build:diaries`
   * have drifted.
   *
   * Empty until the dataset loads, not "everything": with no index every
   * synced id looks unknown, and reporting that would accuse the plugin of
   * sending tiers that don't exist — the same trap `SettingsView` documents for
   * quests.
   */
  const syncUnknownTierIds = computed<string[]>(() => {
    const sync = useSyncStore()
    if (!dataset.value || !sync.snapshot) return []
    return reconcileTiers(sync.snapshot, new Set(index.value.tierById.keys()))
      .unknownIds
  })

  /** Tasks implied by the synced tiers. Not persisted, and never written to `doneTasks`. */
  const syncedTasks = computed<DiaryTaskMap>(() =>
    expandTiers(index.value, syncedTiers.value),
  )

  /**
   * What the app displays and reasons about: the player's own task record with
   * the synced tiers' tasks added. Union, so a snapshot can only add.
   *
   * **This is a computed and nothing persists it.** `diaries:tasks` is written
   * only from `doneTasks`, so a bad snapshot cannot reach disk and turning the
   * merge off restores exactly what the player ticked — the same property
   * `effectiveProgress` gives quests. See ROADMAP.md Phase 5.
   */
  const done = computed<DiaryTaskMap>(() =>
    mergeDoneTasks(doneTasks.value as DiaryTaskMap, syncedTasks.value),
  )

  /** True when the snapshot, not the player, is why this tier reads as done. */
  function isTierSynced(tierId: string): boolean {
    return syncedTiers.value.includes(tierId)
  }

  /** True when this task is done only because its tier was synced. */
  function isTaskSynced(taskId: string): boolean {
    return Boolean(syncedTasks.value[taskId])
  }

  function isTaskDone(taskId: string): boolean {
    return Boolean(done.value[taskId])
  }

  function setTaskDone(taskId: string, value: boolean): void {
    if (!value) {
      const rest = { ...doneTasks.value }
      delete rest[taskId]
      doneTasks.value = rest
      return
    }
    doneTasks.value = { ...doneTasks.value, [taskId]: true }
  }

  /**
   * A task the snapshot says is done can't be cleared from here: un-ticking
   * would edit a local record that never held it, leaving the row checked and
   * the tap apparently ignored. The UI shows these locked; this guard is what
   * keeps a stray call from doing nothing silently.
   */
  function toggleTask(taskId: string): void {
    if (isTaskSynced(taskId)) return
    setTaskDone(taskId, !isTaskDone(taskId))
  }

  /** A tier's state, derived. Nothing writes this. */
  function progressOf(tierId: string): QuestProgress {
    const entry = index.value.tierById.get(tierId)
    return entry ? tierProgressFrom(entry.tier, done.value) : 'todo'
  }

  /**
   * Checks or clears every task in a tier.
   *
   * The shortcut for someone who finished a diary years ago and should not
   * have to tick nineteen boxes to say so. Deliberately written as task
   * completions rather than as a tier-level flag, so there stays exactly one
   * record of what is done.
   */
  function setTierDone(tierId: string, value: boolean): void {
    const entry = index.value.tierById.get(tierId)
    if (!entry) return
    const next = { ...doneTasks.value }
    for (const id of taskIdsOf(entry.tier)) {
      if (value) next[id] = true
      else delete next[id]
    }
    doneTasks.value = next
  }

  /** Locked for a synced tier, for the same reason as `toggleTask`. */
  function toggleTier(tierId: string): void {
    if (isTierSynced(tierId)) return
    setTierDone(tierId, progressOf(tierId) !== 'done')
  }

  /**
   * Every tier's status, keyed by tier id so a route param resolves directly.
   *
   * 48 tiers and their 492 tasks is small enough to evaluate eagerly — unlike
   * the quest dataset, nothing here needs the quest-points shortcut that keeps
   * `evaluateQuest` off an O(n²) path.
   */
  const statuses = computed<Map<string, DiaryTierStatus>>(() => {
    const quests = useQuestsStore()
    const map = new Map<string, DiaryTierStatus>()
    for (const diary of index.value.all) {
      for (const tier of diary.tiers) {
        map.set(
          tier.id,
          evaluateDiaryTier(
            diary,
            tier,
            quests.playerState,
            quests.index,
            done.value,
          ),
        )
      }
    }
    return map
  })

  /** Tiers whose requirements are met and which aren't finished yet. */
  const ready = computed<DiaryTierStatus[]>(() => {
    const quests = useQuestsStore()
    return completableNow(
      index.value,
      quests.playerState,
      quests.index,
      done.value,
    )
  })

  const completion = computed(() => diaryCompletion(index.value, done.value))

  return {
    dataset,
    loading,
    hydrated,
    doneTasks,
    done,
    syncedTiers,
    syncUnknownTierIds,
    index,
    statuses,
    ready,
    completion,
    ensureDataset,
    ensureReady,
    isTaskDone,
    isTaskSynced,
    isTierSynced,
    setTaskDone,
    toggleTask,
    progressOf,
    setTierDone,
    toggleTier,
  }
})
