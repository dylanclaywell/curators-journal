/**
 * GET /api/hiscores?player=NAME&type=normal
 *
 * Proxies Jagex's hiscores, which send no CORS headers and so can't be reached
 * from the page. Returns a `HiscoresResult` either way, so the client always
 * has one shape to handle.
 */
import {
  isValidUsername,
  normalizeUsername,
  parseHiscores,
} from '../../lib/hiscores'
import type { AccountType, HiscoresResult } from '../../lib/types'
import { readCapped } from '../http'

/**
 * Each account type is a separate hiscore table with its own `m=` module.
 *
 * Only `normal` has been verified against a live response. The rest follow
 * Jagex's documented naming, but a wrong module name is indistinguishable from
 * an unknown player — both 404 — so treat a "player not found" report on a
 * non-normal type as a possible bad module name here.
 */
const HISCORE_MODULES: Record<AccountType, string> = {
  normal: 'hiscore_oldschool',
  ironman: 'hiscore_oldschool_ironman',
  hardcore: 'hiscore_oldschool_hardcore_ironman',
  ultimate: 'hiscore_oldschool_ultimate',
  deadman: 'hiscore_oldschool_deadman',
  seasonal: 'hiscore_oldschool_seasonal',
  tournament: 'hiscore_oldschool_tournament',
  skiller: 'hiscore_oldschool_skiller',
  skiller_defence: 'hiscore_oldschool_skiller_defence',
}

const UPSTREAM_TIMEOUT_MS = 8000
/** Real responses are ~10KB; this only exists so a pathological one can't run us out of memory. */
const MAX_BYTES = 256 * 1024
const CACHE_TTL_SECONDS = 60

/** Identifies us to Jagex. Wiki etiquette asks for this and it costs nothing. */
const USER_AGENT =
  'CuratorsJournal/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/curators-journal)'

function json(result: HiscoresResult, status: number, ttl = 0): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Only successes are cacheable. A 60s TTL is enough to absorb a panel
      // remounting repeatedly without ever showing meaningfully stale levels.
      'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store',
    },
  })
}

function fail(
  error: Exclude<HiscoresResult, { ok: true }>['error'],
  message: string,
  status: number,
): Response {
  return json({ ok: false, error, message }, status)
}

export async function handleHiscores(
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'GET') {
    return fail('upstream_error', 'Use GET.', 405)
  }

  const params = new URL(request.url).searchParams
  const rawPlayer = params.get('player') ?? ''
  const rawType = params.get('type') ?? 'normal'

  const username = normalizeUsername(rawPlayer)
  if (!isValidUsername(username)) {
    return fail(
      'invalid_username',
      'That does not look like a username. Check for stray characters.',
      400,
    )
  }

  if (!(rawType in HISCORE_MODULES)) {
    return fail('invalid_username', `Unknown account type "${rawType}".`, 400)
  }
  const accountType = rawType as AccountType

  // A synthetic key, so query-param order and spacing can't split the cache.
  const cacheKey = new Request(
    `https://hiscores.curators-journal.internal/${accountType}/${encodeURIComponent(username)}`,
  )

  // Cache API is a real cache in production and effectively a no-op in some
  // local dev setups — don't be surprised by misses under `npm run dev`.
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

  const upstream = `https://secure.runescape.com/m=${HISCORE_MODULES[accountType]}/index_lite.json?player=${encodeURIComponent(username)}`

  let response: Response
  try {
    response = await fetch(upstream, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return fail('timeout', 'The hiscores did not respond in time.', 504)
    }
    return fail('upstream_error', 'Could not reach the hiscores.', 502)
  }

  // Jagex answers an unknown player with 404 and an HTML body, so the status
  // is the only reliable signal here.
  if (response.status === 404) {
    const board = accountType === 'normal' ? '' : `${accountType} `
    return fail(
      'not_found',
      `No ${board}hiscores entry for "${username}".`,
      404,
    )
  }

  if (!response.ok) {
    return fail(
      'upstream_error',
      `The hiscores returned ${response.status}.`,
      502,
    )
  }

  const text = await readCapped(response, MAX_BYTES)
  if (text === null) {
    return fail(
      'too_large',
      'The hiscores response was implausibly large.',
      502,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('upstream_error', 'The hiscores response was not JSON.', 502)
  }

  const result = parseHiscores(raw, username, accountType, Date.now())
  if (!result.ok) return fail(result.error, result.message, 502)

  const body = json(result, 200, CACHE_TTL_SECONDS)
  ctx.waitUntil(caches.default.put(cacheKey, body.clone()))
  return body
}
