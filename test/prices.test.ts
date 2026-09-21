/**
 * The pure half of `/api/prices`: id parsing and the `/latest` selection.
 *
 * Most of what matters here is the distinction the module exists to protect —
 * "the GE has no price for this item" must come back as an absence inside a
 * successful result, while a caller's bad input must not.
 */
import { describe, expect, it } from 'vitest'
import { parseItemIds, selectPrices } from '../src/lib/prices'

describe('parseItemIds', () => {
  it('parses a comma-separated list', () => {
    expect(parseItemIds('4151,11802')).toEqual([4151, 11802])
  })

  it('sorts and dedupes, so one set of items is one request', () => {
    expect(parseItemIds('11802,4151,4151')).toEqual([4151, 11802])
  })

  it('tolerates trailing and repeated commas', () => {
    expect(parseItemIds('4151,,11802,')).toEqual([4151, 11802])
  })

  it.each([
    ['missing', null],
    ['empty', ''],
    ['only commas', ',,'],
    ['negative', '-4151'],
    ['not a number', 'abyssal-whip'],
    ['padded', ' 4151 '],
    ['exponent', '1e3'],
    ['hex', '0x10'],
    ['fractional', '4151.0'],
  ])('rejects %s input outright', (_label, input) => {
    expect(parseItemIds(input)).toBeNull()
  })

  it('rejects the whole list rather than dropping the bad entry', () => {
    // Dropping it would return two prices for three ids, and the missing one
    // would be indistinguishable from an untradeable item.
    expect(parseItemIds('4151,oops,11802')).toBeNull()
  })
})

const latest = {
  data: {
    '2': { high: 245, highTime: 1790026843, low: 240, lowTime: 1790026781 },
    '26247': {
      high: null,
      highTime: null,
      low: 100000000,
      lowTime: 1635032482,
    },
  },
}

describe('selectPrices', () => {
  it('returns only the ids asked for', () => {
    expect(selectPrices(latest, [2])).toEqual({
      '2': {
        high: 245,
        highTimeMs: 1790026843000,
        low: 240,
        lowTimeMs: 1790026781000,
      },
    })
  })

  it('converts the upstream epoch seconds to milliseconds', () => {
    const prices = selectPrices(latest, [2])!
    // October 2021 for 26247 below; this one is a 2026 date, not a 1970 one.
    expect(new Date(prices['2']!.highTimeMs!).getUTCFullYear()).toBe(2026)
  })

  it('keeps a half-priced item, nulls and all', () => {
    // Measured: 2 of 4537 entries have no `high` and 12 have no `low`. A null
    // here is "nobody traded that side", not zero and not a load failure.
    expect(selectPrices(latest, [26247])).toEqual({
      '26247': {
        high: null,
        highTimeMs: null,
        low: 100000000,
        lowTimeMs: 1635032482000,
      },
    })
  })

  it('omits an id the GE does not price, inside a successful result', () => {
    // A pet or a quest item. The absence is the answer.
    expect(selectPrices(latest, [2, 999999])).toEqual({
      '2': expect.any(Object),
    })
  })

  it.each([
    ['a non-object body', 'nope'],
    ['null', null],
    ['no data key', { items: {} }],
    ['a non-object data key', { data: 'nope' }],
  ])('reports %s as unparseable', (_label, raw) => {
    expect(selectPrices(raw, [2])).toBeNull()
  })

  it('skips an entry that is not an object at all', () => {
    expect(selectPrices({ data: { '2': 'nope' } }, [2])).toEqual({})
  })
})
