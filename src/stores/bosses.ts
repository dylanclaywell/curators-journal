import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { bossTotals, buildBossRows, unclassifiedActivities } from '@/lib/bosses'
import type { BossDataset } from '@/lib/types'
import { useHiscoresStore } from './hiscores'

/**
 * Bosses: a generated dataset joined to the hiscores snapshot we already
 * fetch.
 *
 * **Nothing here is hand-entered, so nothing here is precious.** Both halves
 * are disposable — the dataset ships with the build, the kill counts refetch
 * from a username — which is why this store persists nothing and has no
 * `hydrated` flag. Contrast the quest and diary stores, whose whole shape is
 * dictated by protecting the half that has no other source.
 *
 * It is also why there is no merge question: kill counts are "fetched,
 * read-only" alongside skill levels, so the RuneLite snapshot never touches
 * them.
 */
export const useBossesStore = defineStore('bosses', () => {
  const dataset = ref<BossDataset | null>(null)
  const loading = ref(false)

  const bosses = computed(() => dataset.value?.bosses ?? [])

  /**
   * Its own chunk, like `quests.json` and `diaries.json`.
   *
   * ~144 KB of JSON, so a static import would put it in whatever chunk touched
   * this file. The panel is lazily loaded and this is the only importer, which
   * is what keeps it out of the entry chunk — see the bundle invariants in
   * CLAUDE.md, and check them if this store ever gains a caller that isn't a
   * panel.
   */
  async function ensureDataset(): Promise<void> {
    if (dataset.value || loading.value) return
    loading.value = true
    try {
      const module = await import('@/data/bosses.json')
      dataset.value = module.default as unknown as BossDataset
    } finally {
      loading.value = false
    }
  }

  /**
   * Everything the panel needs: the dataset and the hiscores.
   *
   * `ensureLoaded` rather than an assumption that Stats has been opened — the
   * bug CLAUDE.md records for quest levels would land here identically, as a
   * boss panel showing 183 rows of nothing on a cold load.
   */
  async function ensureReady(): Promise<void> {
    await Promise.all([ensureDataset(), useHiscoresStore().ensureLoaded()])
  }

  /** Every boss, with kill counts joined on where the hiscores publish them. */
  const rows = computed(() =>
    buildBossRows(bosses.value, useHiscoresStore().snapshot?.activities ?? []),
  )

  const totals = computed(() => bossTotals(rows.value))

  /**
   * Activity names the hiscores returned that the dataset can't account for.
   *
   * Expected empty. Anything here means Jagex shipped a boss since
   * `build:bosses` last ran, which is a dataset refresh rather than a bug —
   * surfaced rather than swallowed, like the diary store's drift report.
   */
  const unknownActivities = computed(() =>
    unclassifiedActivities(
      useHiscoresStore().snapshot?.activities ?? [],
      bosses.value,
    ),
  )

  /** True once a snapshot exists, so the panel can tell "0 kills" from "no data". */
  const countsKnown = computed(() => useHiscoresStore().snapshot !== null)

  return {
    dataset,
    loading,
    bosses,
    rows,
    totals,
    unknownActivities,
    countsKnown,
    ensureDataset,
    ensureReady,
  }
})
