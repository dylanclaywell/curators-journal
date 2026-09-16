/**
 * The client's half of the `/api` contract.
 *
 * Lives with the stores because stores are the only things allowed to fetch —
 * panels read data through them, never directly. Keeping this next to its only
 * callers makes that rule visible rather than aspirational.
 */
import type { SyncFetchResult } from '@/lib/sync'
import type { AccountType, HiscoresResult } from '@/lib/types'

/**
 * The route answers with a `HiscoresResult` on every status code, so failure is
 * a value rather than a thrown error. The only case this has to invent is a
 * request that never reached the network at all.
 */
export async function fetchHiscores(
  username: string,
  accountType: AccountType,
): Promise<HiscoresResult> {
  const params = new URLSearchParams({ player: username, type: accountType })

  let response: Response
  try {
    response = await fetch(`/api/hiscores?${params}`)
  } catch {
    return {
      ok: false,
      error: 'offline',
      message: 'No connection.',
    }
  }

  try {
    return (await response.json()) as HiscoresResult
  } catch {
    // A body that isn't JSON means something between us and the route
    // intervened — a captive portal, or a stale service worker serving HTML.
    return {
      ok: false,
      error: 'upstream_error',
      message: `Unreadable response (${response.status}).`,
    }
  }
}

/**
 * Reads the RuneLite snapshot for an account hash.
 *
 * Same contract as the hiscores: the route answers with a `SyncFetchResult` on
 * every status code, so a failure is a value. `offline` is the one case this
 * has to invent, since a request that never left the device has no response to
 * report.
 */
export async function fetchSyncSnapshot(
  accountHash: string,
): Promise<SyncFetchResult> {
  const params = new URLSearchParams({ hash: accountHash })

  let response: Response
  try {
    response = await fetch(`/api/sync?${params}`)
  } catch {
    return {
      ok: false,
      error: 'storage_error',
      message: 'No connection.',
    }
  }

  try {
    return (await response.json()) as SyncFetchResult
  } catch {
    return {
      ok: false,
      error: 'storage_error',
      message: `Unreadable response (${response.status}).`,
    }
  }
}
