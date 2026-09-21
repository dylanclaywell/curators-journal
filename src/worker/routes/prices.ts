/**
 * GET /api/prices?ids=4151,11802
 *
 * Proxies the wiki's Grand Exchange prices. Returns a `PricesResult` on every
 * status code, so the client always has one shape to handle.
 *
 * **This proxy is elective, unlike the hiscores one, and it's worth knowing the
 * difference.** `prices.runescape.wiki` sends `access-control-allow-origin: *`
 * (measured), so a browser could call it directly and it would work. What a
 * browser cannot do is identify itself: the wiki asks callers to send a
 * descriptive `User-Agent` so a misbehaving client can be contacted, and
 * `User-Agent` is a forbidden header in `fetch()` — the browser drops it. So
 * the Worker is here to comply, not to make the call possible. See CLAUDE.md.
 */
import {
  MAX_PRICE_IDS,
  parseItemIds,
  selectPrices,
  type PricesResult,
} from '../../lib/prices'
import { readCapped } from '../http'

const UPSTREAM = 'https://prices.runescape.wiki/api/v1/osrs/latest'

const UPSTREAM_TIMEOUT_MS = 8000
/** The real response measured 343 KB across 4537 items; this is headroom, not a budget. */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Sixty seconds because the source says sixty seconds: `/latest` answers with
 * `cache-control: public, must-revalidate, max-age=60`. Same number as the
 * hiscores route and a better-founded one — there it is pinned to a recompute
 * interval nobody has measured, here the upstream states its own.
 */
const CACHE_TTL_SECONDS = 60

/** Identifies us to the wiki. Etiquette asks for this and it costs nothing. */
const USER_AGENT =
  'CuratorsJournal/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/curators-journal)'

/**
 * One cache entry for the whole upstream payload, not one per id set.
 *
 * The alternative — keying the cache on the ids asked for — would make the
 * upstream request count scale with how many distinct drop tables get opened,
 * which is exactly backwards: every one of them wants the same 343 KB document.
 * Caching the document instead holds us to one request a minute no matter how
 * the app reads it.
 */
const UPSTREAM_CACHE_KEY = new Request(
  'https://prices.curators-journal.internal/latest',
)

function json(result: PricesResult, status: number, ttl = 0): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store',
    },
  })
}

function fail(
  error: Exclude<PricesResult, { ok: true }>['error'],
  message: string,
  status: number,
): Response {
  return json({ ok: false, error, message }, status)
}

/** Fetches the `/latest` document, or returns the failure to hand back. */
async function readLatest(
  ctx: ExecutionContext,
): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  const cached = await caches.default.match(UPSTREAM_CACHE_KEY)
  if (cached) return { ok: true, text: await cached.text() }

  let response: Response
  try {
    response = await fetch(UPSTREAM, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        response: fail(
          'timeout',
          'The price service did not respond in time.',
          504,
        ),
      }
    }
    return {
      ok: false,
      response: fail(
        'upstream_error',
        'Could not reach the price service.',
        502,
      ),
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      response: fail(
        'upstream_error',
        `The price service returned ${response.status}.`,
        502,
      ),
    }
  }

  const text = await readCapped(response, MAX_BYTES)
  if (text === null) {
    return {
      ok: false,
      response: fail(
        'too_large',
        'The price response was implausibly large.',
        502,
      ),
    }
  }

  // Cached as the raw upstream body rather than as our own response, so the
  // TTL covers the document and every id set is served off the one copy.
  ctx.waitUntil(
    caches.default.put(
      UPSTREAM_CACHE_KEY,
      new Response(text, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      }),
    ),
  )

  return { ok: true, text }
}

export async function handlePrices(
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return fail('invalid_request', 'Use GET.', 405)
  }

  const ids = parseItemIds(new URL(request.url).searchParams.get('ids'))
  if (ids === null) {
    return fail(
      'invalid_request',
      'Pass ids as a comma-separated list of item numbers.',
      400,
    )
  }
  if (ids.length > MAX_PRICE_IDS) {
    return fail(
      'invalid_request',
      `Ask for at most ${MAX_PRICE_IDS} items at once.`,
      400,
    )
  }

  const latest = await readLatest(ctx)
  if (!latest.ok) return latest.response

  let raw: unknown
  try {
    raw = JSON.parse(latest.text)
  } catch {
    return fail('upstream_error', 'The price response was not JSON.', 502)
  }

  const prices = selectPrices(raw, ids)
  if (prices === null) {
    return fail(
      'upstream_error',
      'The price response was not the shape we expect.',
      502,
    )
  }

  return json(
    { ok: true, fetchedAt: Date.now(), prices },
    200,
    CACHE_TTL_SECONDS,
  )
}
