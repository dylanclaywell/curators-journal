import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  buildDiaryIndex,
  completableNow,
  diaryCompletion,
  evaluateDiaryTier,
} from '@/lib/diaries'
import type { DiaryProgressMap, DiaryTierStatus } from '@/lib/diaries'
import type { Diary, DiaryDataset } from '@/lib/types'
import type { QuestProgress } from '@/lib/quests'
import { useQuestsStore } from './quests'
import { read, write } from './persist'

/**
 * Achievement diaries, in the same two halves the quest store keeps apart:
 * a generated, disposable dataset, and hand-entered progress that has no
 * other source.
 *
 * Two things differ from the quest store and both are deliberate.
 *
 * **Tier progress is keyed separately from quest progress** (`diaries:progress`
 * rather than a shared map). Tier ids and quest ids are different keyspaces,
 * and one map would let `ardougne-easy` collide with a quest slug — unlikely
 * today, but the kind of collision that silently marks the wrong thing done
 * and is unrecoverable, since both halves are hand-entered.
 *
 * **It leans on the quest store rather than duplicating it.** Diary tiers have
 * quest prerequisites and quest-point requirements, so evaluation needs the
 * quest index and the player's merged quest progress. `ensureReady` pulls
 * both, so no panel can depend on Quests having been visited first — the bug
 * CLAUDE.md records for levels, which would land here the same way.
 */
const PROGRESS_KEY = 'diaries:progress'

export const useDiariesStore = defineStore('diaries', () => {
  const dataset = ref<DiaryDataset | null>(null)
  const loading = ref(false)

  /** Only non-default states are stored, so `todo` is the absence of an entry. */
  const progress = ref<Record<string, QuestProgress>>({})

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
   * import here would add another 234 KB to whatever chunk touched it.
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
    const saved = await read<Record<string, QuestProgress>>(PROGRESS_KEY)
    if (saved) progress.value = saved
    hydrated.value = true
  }

  watch(
    progress,
    () => {
      if (!hydrated.value) return
      void write(PROGRESS_KEY, progress.value)
    },
    { deep: true },
  )

  void hydrate()

  const diaryProgress = computed<DiaryProgressMap>(
    () => progress.value as DiaryProgressMap,
  )

  function progressOf(id: string): QuestProgress {
    return progress.value[id] ?? 'todo'
  }

  function setProgress(id: string, state: QuestProgress): void {
    if (state === 'todo') {
      const rest = { ...progress.value }
      delete rest[id]
      progress.value = rest
      return
    }
    progress.value = { ...progress.value, [id]: state }
  }

  /** Cycles todo → doing → done → todo, as quest rows do. */
  function cycleProgress(id: string): void {
    const next: Record<QuestProgress, QuestProgress> = {
      todo: 'doing',
      doing: 'done',
      done: 'todo',
    }
    setProgress(id, next[progressOf(id)])
  }

  /**
   * Every tier's status. Keyed by tier id, so a route param resolves directly.
   *
   * 48 tiers x their tasks is small enough to evaluate eagerly — unlike the
   * quest dataset, nothing here needs the quest-points shortcut that keeps
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
            diaryProgress.value,
          ),
        )
      }
    }
    return map
  })

  /** Tiers whose requirements are met and which aren't done yet. */
  const ready = computed<DiaryTierStatus[]>(() => {
    const quests = useQuestsStore()
    return completableNow(
      index.value,
      quests.playerState,
      quests.index,
      diaryProgress.value,
    )
  })

  const completion = computed(() =>
    diaryCompletion(index.value, diaryProgress.value),
  )

  return {
    dataset,
    loading,
    hydrated,
    progress,
    index,
    statuses,
    ready,
    completion,
    ensureDataset,
    ensureReady,
    progressOf,
    setProgress,
    cycleProgress,
  }
})
