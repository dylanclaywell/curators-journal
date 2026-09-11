import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  combatLevelOf,
  isValidUsername,
  normalizeUsername,
} from '@/lib/hiscores'
import type { AccountType, HiscoresError, HiscoresSnapshot } from '@/lib/types'
import { fetchHiscores } from './api'
import { useSettingsStore } from './settings'
import { read, write } from './persist'

export type HiscoresStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Deliberately equal to the Worker's Cache API TTL. A resume inside this window
 * would be served from that cache anyway, so refreshing sooner costs an upstream
 * request and buys nothing; refreshing later than it leaves data on screen that
 * the Worker would already have replaced for free.
 *
 * Whether this is the *useful* resolution is a separate question — the hiscores
 * themselves lag actual gameplay by an unmeasured amount, and there's no point
 * polling faster than they recompute.
 */
const STALE_AFTER_MS = 60_000

function cacheKey(username: string, accountType: AccountType): string {
  return `hiscores:${accountType}:${username.toLowerCase()}`
}

export const useHiscoresStore = defineStore('hiscores', () => {
  const snapshot = ref<HiscoresSnapshot | null>(null)
  const status = ref<HiscoresStatus>('idle')
  const error = ref<{ code: HiscoresError; message: string } | null>(null)

  /**
   * Guards against a slow earlier request landing after a newer one. Without
   * it, typing a second name while the first is in flight can leave the panel
   * showing whichever happened to finish last.
   */
  let latestRequest = 0

  const combat = computed(() =>
    snapshot.value ? combatLevelOf(snapshot.value) : null,
  )

  /** True while showing data we know is from a failed or skipped refresh. */
  const stale = computed(() => Boolean(snapshot.value && error.value))

  async function load(
    usernameInput: string,
    accountType: AccountType,
  ): Promise<void> {
    const username = normalizeUsername(usernameInput)

    if (!isValidUsername(username)) {
      error.value = {
        code: 'invalid_username',
        message: 'Enter a username first.',
      }
      status.value = 'error'
      return
    }

    const request = ++latestRequest
    const key = cacheKey(username, accountType)

    // Show the last known values immediately. The app is swapped away from and
    // back to constantly, so a spinner on every return would be the dominant
    // experience of using it.
    const showingSameAccount =
      snapshot.value?.username === username &&
      snapshot.value?.accountType === accountType

    if (!showingSameAccount) {
      snapshot.value = null
      const cached = await read<HiscoresSnapshot>(key)
      if (request !== latestRequest) return
      if (cached) {
        snapshot.value = cached
        status.value = 'ready'
      }
    }

    // Only claim to be loading when there's nothing to look at meanwhile.
    status.value = snapshot.value ? 'ready' : 'loading'

    const result = await fetchHiscores(username, accountType)
    if (request !== latestRequest) return

    if (result.ok) {
      snapshot.value = result.snapshot
      error.value = null
      status.value = 'ready'
      void write(key, result.snapshot)
      return
    }

    error.value = { code: result.error, message: result.message }

    // A failed refresh must not blank out good data — going offline mid-session
    // should leave the levels on screen, marked stale.
    if (snapshot.value && result.error !== 'not_found') {
      status.value = 'ready'
    } else {
      snapshot.value = null
      status.value = 'error'
    }
  }

  /**
   * Called when the app comes back to the foreground. The whole app is swapped
   * away from and back to constantly, so this is the normal refresh path —
   * a mount-time load only covers the first open.
   *
   * Quietly does nothing when there's nothing to refresh or the data is still
   * fresh, so it's safe to call on every resume.
   */
  async function refreshIfStale(): Promise<void> {
    const current = snapshot.value
    if (!current) return
    if (Date.now() - current.fetchedAt < STALE_AFTER_MS) return
    await load(current.username, current.accountType)
  }

  /**
   * Makes levels available to any panel, not just the one that fetches them.
   *
   * Without this the store is **inert unless StatsView has mounted**: it seeded
   * the only snapshot, so a cold load straight into the quest panel saw no
   * levels and reported that no username was set — when one was. Tabbing to
   * Stats and back "fixed" it, which is the signature of this bug.
   *
   * Safe to call from anywhere on mount. It returns immediately when a
   * snapshot already exists, and `load` shows the cached snapshot before it
   * fetches, so levels appear without waiting on the network.
   */
  async function ensureLoaded(): Promise<void> {
    if (snapshot.value || status.value === 'loading') return

    const settings = useSettingsStore()
    if (!settings.hydrated) {
      // Reads are async, so a caller mounting during startup would otherwise
      // act on the empty defaults and conclude there's no account configured.
      await new Promise<void>((resolve) => {
        const stop = watch(
          () => settings.hydrated,
          (ready) => {
            if (!ready) return
            stop()
            resolve()
          },
        )
      })
    }

    if (!settings.username) return
    await load(settings.username, settings.accountType)
  }

  function clear(): void {
    latestRequest++
    snapshot.value = null
    error.value = null
    status.value = 'idle'
  }

  return {
    snapshot,
    status,
    error,
    combat,
    stale,
    load,
    ensureLoaded,
    refreshIfStale,
    clear,
  }
})
