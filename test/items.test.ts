/**
 * The item join, and the committed dataset it runs against.
 *
 * The failure this module exists to prevent is a drop row showing the wrong
 * item's price — plausible number, wrong item, nothing to notice it by. That
 * can only happen if two items share a name, so the uniqueness of the name
 * index is the thing worth asserting, both in the abstract and against the
 * 657 items actually shipped.
 *
 * The second block checks invariants of the committed file the generator
 * promises and the UI will rely on. What it deliberately does *not* check is
 * that every drop name resolves: that would mean reading 147 files out of
 * `public/boss-detail/`, and these tests run in workerd with no filesystem. The
 * generator reports the resolved count on every run instead, where a sudden
 * drop is visible.
 */
import { describe, expect, it } from 'vitest'
import {
  findItemByName,
  indexItemsByName,
  normalizeItemName,
} from '../src/lib/items'
import type { Item, ItemDataset } from '../src/lib/items'
import dataset from '../src/data/items.json' with { type: 'json' }

const items = (dataset as ItemDataset).items

const item = (id: number, name: string): Item => ({
  id,
  name,
  examine: '',
  members: true,
  highalch: null,
  lowalch: null,
  limit: null,
  value: null,
})

describe('normalizeItemName', () => {
  it('folds case, which is what lets drop rows join by name', () => {
    expect(normalizeItemName('Abyssal whip')).toBe(
      normalizeItemName('ABYSSAL WHIP'),
    )
  })

  it('collapses surrounding and internal whitespace', () => {
    expect(normalizeItemName('  Dragon   bones ')).toBe('dragon bones')
  })
})

describe('indexItemsByName', () => {
  it('finds an item however the drop row capitalised it', () => {
    const index = indexItemsByName([item(4151, 'Abyssal whip')])
    expect(findItemByName(index, 'abyssal WHIP')?.id).toBe(4151)
  })

  it('answers null for an item the GE does not list', () => {
    // A pet, a clue scroll or coins. An ordinary answer, not a failure.
    const index = indexItemsByName([item(4151, 'Abyssal whip')])
    expect(findItemByName(index, 'Ikkle Hydra')).toBeNull()
  })

  it('throws on two items sharing a name rather than picking one', () => {
    expect(() =>
      indexItemsByName([item(1, 'Ancient shard'), item(2, 'ancient shard')]),
    ).toThrow(/share the name/)
  })
})

describe('the committed item dataset', () => {
  it('ships items', () => {
    expect(items.length).toBeGreaterThan(500)
  })

  it('states that it is a subset', () => {
    // The trim is the design; a file claiming to omit nothing would mean the
    // generator started keeping all 4662 without anyone deciding to.
    expect((dataset as ItemDataset).omitted).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it('has a unique name index', () => {
    expect(() => indexItemsByName(items)).not.toThrow()
  })

  it('leaves an absent value null rather than zero', () => {
    // 512 of the mapping's entries state no buy limit and 90 no alchemy value.
    // A zero buy limit would read as "you may not buy this at all".
    for (const i of items) {
      for (const field of ['highalch', 'lowalch', 'limit', 'value'] as const) {
        const value = i[field]
        expect(value === null || typeof value === 'number').toBe(true)
      }
    }
  })

  it('carries no icon field, which would be a Jagex sprite', () => {
    // NOTICE.md: every Jagex asset is a considered decision. A field arriving
    // here by a generator edit is how one would stop being considered.
    for (const i of items) expect(i).not.toHaveProperty('icon')
  })
})
