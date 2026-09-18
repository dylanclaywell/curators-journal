import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { QuestGuide } from '@/lib/types'

/**
 * The wiki's quick-guide walkthroughs, one quest at a time.
 *
 * Unlike every other store here, this one holds no dataset and persists
 * nothing. The guides are ~870 KB across 204 static files under
 * `public/guides/`, deliberately kept out of the bundle *and* out of the
 * precache (see CLAUDE.md), so the only sane unit to load is the one quest the
 * player is looking at.
 *
 * Nothing is written to IndexedDB either, and that is not an oversight: this is
 * fetched, read-only, regenerable data — the opposite of the hand-entered
 * completions the app treats as precious. The service worker's
 * stale-while-revalidate rule already keeps an opened guide available offline,
 * which is the case that matters. Persisting it again here would be a second
 * copy with its own staleness and no owner.
 */
export const useGuidesStore = defineStore('guides', () => {
  /**
   * Quest id -> guide, or `null` for "asked, and there isn't one".
   *
   * The null is load-bearing. Ten quests have no guide — two pages don't exist
   * and eight redirect to the quest page — and without a way to record that,
   * every visit to one of them would re-request a file the server has already
   * said isn't there.
   */
  const byId = ref<Record<string, QuestGuide | null>>({})

  /** Quest ids currently in flight, so a remount can't double-fetch. */
  const loading = ref<Record<string, true>>({})

  /**
   * Quest ids whose request never completed, as distinct from having no guide.
   *
   * Offline with nothing cached lands here, and it has to read differently from
   * "this quest has no walkthrough": one is worth a retry and the other never
   * will be. Conflating them would tell a player on a dropped connection that
   * the wiki has no guide for Dragon Slayer II.
   */
  const failed = ref<Record<string, true>>({})

  function has(id: string): boolean {
    return id in byId.value
  }

  /**
   * Loads one quest's walkthrough, at most once.
   *
   * **A missing guide does not arrive as a 404.** `not_found_handling:
   * "single-page-application"` is what makes deep links work, and it applies to
   * every unmatched path, so asking for a guide that doesn't exist returns
   * `200 text/html` — the app's own `index.html`. The dev server does the same.
   * Reading the status alone therefore classifies all ten guide-less quests as
   * broken, and they would sit behind a "couldn't be loaded, try again" that
   * never comes right.
   *
   * So the split is by *what answered*, not by status code:
   *
   *   - The request never completed (offline, timeout) — `fetch` itself
   *     rejects. A real failure, worth retrying.
   *   - The server answered with something that is not this quest's guide —
   *     a 404, or the SPA fallback. There is no guide; record `null` and stop
   *     asking.
   *
   * The id check is what distinguishes the second case, and it has to be the
   * id rather than just "did it parse": `index.html` fails to parse today, but
   * a fallback that ever returned some other valid JSON would otherwise render
   * as a walkthrough belonging to a different quest.
   */
  async function ensureGuide(id: string): Promise<void> {
    if (has(id) || loading.value[id]) return

    loading.value = { ...loading.value, [id]: true }
    const stillFailed = { ...failed.value }
    delete stillFailed[id]
    failed.value = stillFailed

    let response: Response
    try {
      response = await fetch(`/guides/${encodeURIComponent(id)}.json`)
    } catch {
      failed.value = { ...failed.value, [id]: true }
      clearLoading(id)
      return
    }

    try {
      const guide = response.ok ? ((await response.json()) as QuestGuide) : null
      const usable =
        guide && guide.id === id && Array.isArray(guide.sections) ? guide : null
      byId.value = { ...byId.value, [id]: usable }
    } catch {
      // A body that isn't JSON is the SPA fallback, which means no such guide.
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

  return { byId, loading, failed, has, ensureGuide }
})
