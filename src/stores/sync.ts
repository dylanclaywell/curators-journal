/**
 * The RuneLite snapshot: fetched, cached, and never written into the player's
 * own record.
 *
 * This is the third kind of data described in ROADMAP.md Phase 5, and the
 * separation it needs is structural rather than careful. Two keys, and they
 * mean different things:
 *
 *   - `sync:settings` is hand-entered — the account hash, and whether to merge
 *     at all. Precious in the small way a username is: losing it means going
 *     back to RuneLite for a nineteen-digit number. It's in the backup.
 *   - `sync:snapshot` is a cache. Disposable, refetchable, and **never merged
 *     into `quests:progress` on disk**. The merge happens in a computed in the
 *     quests store, so switching it off restores exactly what was there.
 *
 * Nothing in this file writes to the quest store. That isn't discipline, it's
 * the design: there is no code path from a fetched snapshot to the player's
 * progress, which is what makes a hostile or stale snapshot survivable.
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { StoredSnapshot } from '@/lib/sync'
import { fetchSyncSnapshot } from './api'
import { read, write } from './persist'

const SETTINGS_KEY = 'sync:settings'
const SNAPSHOT_KEY = 'sync:snapshot'

interface PersistedSyncSettings {
  accountHash: string
  mergeEnabled: boolean
}

export const useSyncStore = defineStore('sync', () => {
  /**
   * RuneLite's `getAccountHash()`, pasted in from the plugin's panel. It is an
   * identifier rather than a secret — anyone holding it can read or write that
   * row — which is a considered trade, not an oversight.
   */
  const accountHash = ref('')

  /**
   * Off by default. Turning it on is the player saying "trust the plugin",
   * and turning it back off is a complete undo because nothing was written.
   */
  const mergeEnabled = ref(false)

  const snapshot = ref<StoredSnapshot | null>(null)

  const loading = ref(false)

  /** The last failure, kept so the UI can say what went wrong rather than just failing quietly. */
  const error = ref<string | null>(null)

  const hydrated = ref(false)

  async function hydrate(): Promise<void> {
    const [settings, cached] = await Promise.all([
      read<PersistedSyncSettings>(SETTINGS_KEY),
      read<StoredSnapshot>(SNAPSHOT_KEY),
    ])
    if (settings) {
      accountHash.value = settings.accountHash ?? ''
      mergeEnabled.value = settings.mergeEnabled ?? false
    }
    if (cached) snapshot.value = cached
    hydrated.value = true
  }

  // Persist after hydration only, or the empty defaults overwrite what was
  // saved during startup — the same hazard the settings store guards against.
  watch([accountHash, mergeEnabled], () => {
    if (!hydrated.value) return
    void write(SETTINGS_KEY, {
      accountHash: accountHash.value,
      mergeEnabled: mergeEnabled.value,
    })
  })

  watch(snapshot, () => {
    if (!hydrated.value) return
    void write(SNAPSHOT_KEY, snapshot.value)
  })

  /**
   * Fetches a fresh snapshot. Used by the refresh button and by
   * `ensureLoaded`; the cached copy stays in place if this fails, since a
   * network blip shouldn't empty the panel.
   */
  async function refresh(): Promise<void> {
    if (!accountHash.value || loading.value) return

    loading.value = true
    error.value = null
    try {
      const result = await fetchSyncSnapshot(accountHash.value)
      if (result.ok) {
        snapshot.value = result.snapshot
      } else {
        error.value = result.message
        // A 404 is not a failure to report over the old data — it means this
        // account has genuinely never synced, so the cache should go too.
        if (result.error === 'not_found') snapshot.value = null
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * What a panel calls on mount: hydrates from storage, then fetches once per
   * session if there's a hash configured.
   *
   * Fetching on open rather than on a timer is deliberate — the plugin writes
   * when the player syncs, not continuously, so there is no cadence worth
   * guessing. The refresh button covers "I just synced".
   */
  async function ensureLoaded(): Promise<void> {
    if (!hydrated.value) await hydrate()
    if (!accountHash.value || snapshot.value) return
    await refresh()
  }

  /** Forgets the cached snapshot without touching what the player entered. */
  function clearSnapshot(): void {
    snapshot.value = null
    error.value = null
  }

  void hydrate()

  return {
    accountHash,
    mergeEnabled,
    snapshot,
    loading,
    error,
    hydrated,
    refresh,
    ensureLoaded,
    clearSnapshot,
  }
})
