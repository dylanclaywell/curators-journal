/**
 * Grand Exchange prices: the shapes crossing client ↔ Worker, and the parse of
 * the wiki's `/latest` response.
 *
 * Pure — no DOM, no network — because `src/worker/routes/prices.ts` and the
 * client both compile against it. Types live here rather than in `types.ts`
 * following `sync.ts`: the parse and the shape it produces are one idea, and
 * the item vocabulary is about to grow (see ROADMAP.md Phase 8).
 */

/**
 * One item's latest trade, as the Grand Exchange last saw it.
 *
 * **`high` and `low` are independently nullable** and were measured so: of 4537
 * entries, 2 have no `high` and 12 have no `low`, and none lacked both. A null
 * means nobody has traded that side recently enough for the GE to publish a
 * figure — it is not zero, and it is not a failure to load.
 *
 * The times matter as much as the prices, which is why they are carried rather
 * than dropped. `Gilded scimitar` (26247) last traded in October 2021: the
 * number is real and four years old, and a price shown without its age invites
 * the player to plan around it.
 */
export interface ItemPrice {
  /** Most recent instant-buy price, in coins. */
  high: number | null
  /**
   * When that buy happened, epoch **milliseconds**.
   *
   * The upstream publishes epoch *seconds*; this is converted at parse time and
   * the unit is in the name deliberately. `PricesResult.fetchedAt` is ms, as
   * every other timestamp in this app is, and two units inside one object is
   * the kind of bug that renders as a date in 1970 or in the year 58000.
   */
  highTimeMs: number | null
  /** Most recent instant-sell price, in coins. */
  low: number | null
  lowTimeMs: number | null
}

export type PricesError =
  /** The `ids` parameter was missing, malformed, or asked for too many. */
  | 'invalid_request'
  | 'upstream_error'
  | 'timeout'
  | 'too_large'
  /** Client-only: the request never left the device. The Worker never sends this. */
  | 'offline'

/**
 * Discriminated result, same contract as `HiscoresResult`: the route answers
 * with one of these on every status code, so a failure is a value.
 *
 * **A requested id absent from `prices` is an answer, not a gap.** The GE
 * publishes prices for tradeable items only, and a third of the names in our
 * drop tables are pets, quest items and other untradeables that will never
 * appear here. `ok: true` means we heard from the source; the absence is the
 * source saying there is no price. Callers must render that as a fact about the
 * item and not as "still loading" — see ROADMAP.md Phase 8.
 */
export type PricesResult =
  | {
      ok: true
      /** Epoch ms we fetched, for the "as of" label. */
      fetchedAt: number
      /** Keyed by item id as a decimal string, because JSON keys are strings. */
      prices: Record<string, ItemPrice>
    }
  | { ok: false; error: PricesError; message: string }

/**
 * How many ids one request may ask for.
 *
 * Sized for the real caller: a boss drop table is the widest thing that will
 * ever want prices at once, and the largest we hold is well under this. The cap
 * exists so `?ids=` can't be used to reassemble the whole 343 KB dataset
 * request by request — that is what the build-time item dataset is for.
 */
export const MAX_PRICE_IDS = 200

/**
 * Parses the `ids` query parameter into item ids.
 *
 * Returns `null` rather than skipping bad entries. A caller that asked for five
 * ids and one typo must not silently get four back — the missing one would be
 * indistinguishable from an untradeable item, which is the one distinction this
 * module exists to keep clean.
 */
export function parseItemIds(param: string | null): number[] | null {
  if (param === null) return null

  const parts = param.split(',').filter((part) => part.length > 0)
  if (parts.length === 0) return null

  const ids: number[] = []
  for (const part of parts) {
    // Deliberately strict: `Number` would accept "1e3", " 12 " and "0x10".
    if (!/^\d{1,7}$/.test(part)) return null
    ids.push(Number(part))
  }

  // Sorted and deduped so the same set of items is the same request whatever
  // order the caller happened to hold them in.
  return [...new Set(ids)].sort((a, b) => a - b)
}

function readPrice(value: unknown): ItemPrice | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>

  const num = (key: string): number | null => {
    const raw = row[key]
    if (raw === null || raw === undefined) return null
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }

  const high = num('high')
  const low = num('low')
  const highTime = num('highTime')
  const lowTime = num('lowTime')

  return {
    high,
    highTimeMs: highTime === null ? null : highTime * 1000,
    low,
    lowTimeMs: lowTime === null ? null : lowTime * 1000,
  }
}

/**
 * Pulls the requested ids out of a `/latest` response body.
 *
 * Returns `null` only when the body isn't the shape the endpoint documents —
 * an id the response simply doesn't carry is left out of the result, which is
 * the "no price exists" answer described on `PricesResult`.
 */
export function selectPrices(
  raw: unknown,
  ids: readonly number[],
): Record<string, ItemPrice> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const data = (raw as Record<string, unknown>).data
  if (typeof data !== 'object' || data === null) return null

  const table = data as Record<string, unknown>
  const prices: Record<string, ItemPrice> = {}
  for (const id of ids) {
    const key = String(id)
    // No `hasOwn` guard needed: ids are digits only (`parseItemIds`), so a key
    // can never reach `constructor` or another prototype property, and a
    // missing one reads as `undefined`, which `readPrice` rejects.
    const price = readPrice(table[key])
    if (price !== null) prices[key] = price
  }
  return prices
}
