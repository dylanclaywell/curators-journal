import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BossDetail } from '@/lib/types'

/**
 * One boss's drop tables and fight prose, fetched when it is opened.
 *
 * The same shape as the guides store and for the same reasons: 147 static
 * files under `public/boss-detail/`, deliberately out of the bundle *and* out
 * of the precache (see CLAUDE.md), so the only sane unit to load is the boss
 * the player is looking at. Nothing is persisted — this is fetched,
 * read-only, regenerable data, and the service worker's stale-while-revalidate
 * rule already covers the offline case that matters.
 *
 * The path is `/boss-detail/`, not `/bosses/`, because `/bosses/:id` is the
 * detail route — see vite.config.ts.
 */
export const useBossDetailStore = defineStore('bossDetail', () => {
  /**
   * Boss id -> detail, or `null` for "asked, and there is none".
   *
   * The null is load-bearing, as in the guides store. 36 of the 183 bosses
   * have neither a drop table nor a fight overview, and without a way to
   * record that, every visit would re-request a file the server has already
   * said isn't there.
   */
  const byId = ref<Record<string, BossDetail | null>>({})

  /** Boss ids currently in flight, so a remount can't double-fetch. */
  const loading = ref<Record<string, true>>({})

  /**
   * Ids whose request never completed, as distinct from having no detail.
   * Offline with nothing cached lands here and is worth a retry; "this boss
   * has no drop table" never is.
   */
  const failed = ref<Record<string, true>>({})

  function has(id: string): boolean {
    return id in byId.value
  }

  /**
   * Loads one boss's detail, at most once.
   *
   * **A missing file does not arrive as a 404.**
   * `not_found_handling: "single-page-application"` is what makes deep links
   * work, and it applies to every unmatched path, so asking for a file that
   * doesn't exist returns `200 text/html` — the app's own `index.html`.
   * Verified against the running app, not assumed. So the split is by *what
   * answered*, not by status: a rejected `fetch` is a real failure, while an
   * answer that isn't this boss's detail means there is none.
   *
   * The id check is what distinguishes the second case, and it has to be the
   * id rather than just "did it parse" — a fallback that ever returned some
   * other valid JSON would otherwise render as another boss's drop table.
   */
  async function ensureDetail(id: string): Promise<void> {
    if (has(id) || loading.value[id]) return

    loading.value = { ...loading.value, [id]: true }
    const stillFailed = { ...failed.value }
    delete stillFailed[id]
    failed.value = stillFailed

    let response: Response
    try {
      response = await fetch(`/boss-detail/${encodeURIComponent(id)}.json`)
    } catch {
      failed.value = { ...failed.value, [id]: true }
      clearLoading(id)
      return
    }

    try {
      const detail = response.ok
        ? ((await response.json()) as BossDetail)
        : null
      const usable =
        detail && detail.id === id && Array.isArray(detail.tables)
          ? detail
          : null
      byId.value = { ...byId.value, [id]: usable }
    } catch {
      // A body that isn't JSON is the SPA fallback: no such file.
      byId.value = { ...byId.value, [id]: null }
    } finally {
      clearLoading(id)
    }
  }

  function clearLoading(id: string): void {
    const next = { ...loading.value }
    delete next[id]
    loading.value = next
  }

  return { byId, loading, failed, has, ensureDetail }
})
