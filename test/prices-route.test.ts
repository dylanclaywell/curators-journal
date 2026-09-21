/**
 * `/api/prices` end to end: the real router, the real handler, a stubbed wiki.
 *
 * The upstream is the one thing that can't be real here — it is a volunteer-run
 * service and a test suite has no business calling it on every run — so the
 * global `fetch` is stubbed. That reaches the handler because the `main` worker
 * runs in this same isolate, which `cloudflare:test` documents on `SELF`.
 *
 * Note `fetchMock` is *not* the tool for this: pool 0.22 dropped it, and
 * examples on the web still reach for it.
 *
 * **The Cache API is real here**, and shares one store across every test in
 * this file — the first success otherwise answers the failure cases and they
 * all pass with a 200. Hence the eviction in `beforeEach`. That it works at all
 * is worth knowing: the hiscores route's caching has never been exercised.
 */
import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const UPSTREAM = 'https://prices.runescape.wiki/api/v1/osrs/latest'

/** Must match the handler's own key. */
const CACHE_KEY = new Request('https://prices.curators-journal.internal/latest')

const LATEST = {
  data: {
    '2': { high: 245, highTime: 1790026843, low: 240, lowTime: 1790026781 },
    '4151': {
      high: 1550000,
      highTime: 1790026800,
      low: 1540000,
      lowTime: 1790026700,
    },
  },
}

/** Stands in for the wiki, and records what we asked it for. */
function stubUpstream(
  body: unknown = LATEST,
  init: { status?: number } = {},
): { requests: Request[] } {
  const requests: Request[] = []
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, opts?: RequestInit) => {
      const request = new Request(input as RequestInfo, opts)
      if (!request.url.startsWith(UPSTREAM)) {
        throw new Error(`Unexpected fetch: ${request.url}`)
      }
      requests.push(request)
      return new Response(
        typeof body === 'string' ? body : JSON.stringify(body),
        { status: init.status ?? 200 },
      )
    },
  )
  return { requests }
}

beforeEach(() => caches.default.delete(CACHE_KEY))
afterEach(() => vi.unstubAllGlobals())

const get = (query: string) => SELF.fetch(`https://app.test/api/prices${query}`)

describe('GET /api/prices', () => {
  it('returns the prices asked for', async () => {
    stubUpstream()

    const res = await get('?ids=4151')
    expect(res.status).toBe(200)

    const body = await res.json<{
      ok: boolean
      fetchedAt: number
      prices: Record<string, unknown>
    }>()
    expect(body.ok).toBe(true)
    expect(body.prices['4151']).toEqual({
      high: 1550000,
      highTimeMs: 1790026800000,
      low: 1540000,
      lowTimeMs: 1790026700000,
    })
    expect(Number.isFinite(body.fetchedAt)).toBe(true)
  })

  it('identifies us to the wiki, which is the whole reason this is proxied', async () => {
    const { requests } = stubUpstream()

    await get('?ids=2')

    expect(requests[0]?.headers.get('user-agent')).toMatch(/^CuratorsJournal\//)
  })

  it('reads the document once and serves every id set from it', async () => {
    const { requests } = stubUpstream()

    await get('?ids=2')
    await get('?ids=4151')

    // The alternative — keying the cache on the ids asked for — would make the
    // upstream request count scale with how many drop tables get opened.
    expect(requests).toHaveLength(1)
  })

  it('leaves out an item the GE does not price, and still reports success', async () => {
    stubUpstream()

    const res = await get('?ids=2,999999')
    const body = await res.json<{
      ok: boolean
      prices: Record<string, unknown>
    }>()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(Object.keys(body.prices)).toEqual(['2'])
  })

  it('lets the response be cached for as long as the wiki asks', async () => {
    stubUpstream()

    const res = await get('?ids=2')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
  })

  it.each([
    ['no ids at all', ''],
    ['an empty list', '?ids='],
    ['a name instead of a number', '?ids=abyssal-whip'],
    ['one bad entry among good ones', '?ids=2,oops,4151'],
  ])('rejects %s without calling the wiki', async (_label, query) => {
    const { requests } = stubUpstream()

    const res = await get(query)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(requests).toHaveLength(0)
  })

  it('refuses a request that would reassemble the whole dataset', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1).join(',')

    const res = await get(`?ids=${ids}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
  })

  it('refuses a non-GET', async () => {
    const res = await SELF.fetch('https://app.test/api/prices?ids=2', {
      method: 'POST',
    })
    expect(res.status).toBe(405)
  })

  it('reports an upstream failure as a value, not a throw', async () => {
    stubUpstream({}, { status: 503 })

    const res = await get('?ids=2')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'upstream_error',
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('reports a body that is not JSON', async () => {
    stubUpstream('<html>maintenance</html>')

    const res = await get('?ids=2')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'upstream_error',
    })
  })

  it('reports a body that is JSON but not the documented shape', async () => {
    stubUpstream({ items: {} })

    const res = await get('?ids=2')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'upstream_error',
    })
  })
})
