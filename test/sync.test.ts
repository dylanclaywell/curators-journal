/**
 * `src/lib/sync.ts` guards the one boundary in this app where untrusted input
 * meets data that can't be recovered. These tests are mostly about what it
 * *refuses*, since accepting a malformed snapshot is the failure that matters
 * — a rejected one is visible, a half-parsed one gets merged and believed.
 */
import { describe, expect, it } from 'vitest'
import {
  isBelowSynced,
  mergeProgress,
  parseStoredSnapshot,
  parseSyncSnapshot,
  reconcileSnapshot,
  reconcileTiers,
  SYNC_SCHEMA_VERSION,
} from '../src/lib/sync'

const valid = {
  schemaVersion: SYNC_SCHEMA_VERSION,
  accountHash: '1234567890',
  quests: {
    'cooks-assistant': 'done',
    'dragon-slayer-i': 'doing',
  },
}

describe('parseSyncSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    const result = parseSyncSnapshot(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.accountHash).toBe('1234567890')
      expect(result.snapshot.quests).toEqual({
        'cooks-assistant': 'done',
        'dragon-slayer-i': 'doing',
      })
    }
  })

  it('drops todo entries, since absence is the default everywhere else', () => {
    const result = parseSyncSnapshot({
      ...valid,
      quests: { ...valid.quests, 'x-marks-the-spot': 'todo' },
    })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect('x-marks-the-spot' in result.snapshot.quests).toBe(false)
  })

  it.each([
    ['a logged-out account hash', { ...valid, accountHash: '-1' }],
    ['a non-string account hash', { ...valid, accountHash: 1234567890 }],
    ['an empty account hash', { ...valid, accountHash: '' }],
    ['an unsupported schema version', { ...valid, schemaVersion: 2 }],
    ['a missing schema version', { accountHash: '1', quests: {} }],
    ['a missing quest map', { schemaVersion: 1, accountHash: '1' }],
    ['a quest map that is an array', { ...valid, quests: [] }],
    ['an unknown progress state', { ...valid, quests: { a: 'finished' } }],
    ['a non-string progress state', { ...valid, quests: { a: 3 } }],
    [
      'a non-kebab-case id',
      { ...valid, quests: { 'Cooks Assistant': 'done' } },
    ],
    ['an over-long id', { ...valid, quests: { ['a'.repeat(65)]: 'done' } }],
  ])('rejects %s', (_label, input) => {
    expect(parseSyncSnapshot(input).ok).toBe(false)
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'snapshot'],
    ['a number', 7],
  ])('rejects %s at the top level', (_label, input) => {
    expect(parseSyncSnapshot(input).ok).toBe(false)
  })

  it('rejects more entries than the dataset could ever have', () => {
    const quests: Record<string, string> = {}
    for (let i = 0; i < 401; i++) quests[`quest-${i}`] = 'done'
    expect(parseSyncSnapshot({ ...valid, quests }).ok).toBe(false)
  })

  it('rejects a prototype-polluting key', () => {
    // JSON.parse makes this an own property, so it reaches Object.entries and
    // has to be turned away by the id pattern rather than by luck.
    const quests = JSON.parse('{"__proto__": "done"}')
    expect(parseSyncSnapshot({ ...valid, quests }).ok).toBe(false)
  })

  it('explains why it refused', () => {
    const result = parseSyncSnapshot({ ...valid, accountHash: '-1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/account hash/i)
  })
})

describe('parseSyncSnapshot diaries', () => {
  it('treats a missing diaries key as no tiers, not an error', () => {
    // What a plugin that predates diaries sends, and it must keep validating
    // at schema version 1.
    const result = parseSyncSnapshot(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.snapshot.diaries).toEqual({ tiers: [] })
  })

  it('accepts a list of tier ids', () => {
    const result = parseSyncSnapshot({
      ...valid,
      diaries: { tiers: ['ardougne-easy', 'falador-hard'] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.diaries?.tiers).toEqual([
        'ardougne-easy',
        'falador-hard',
      ])
    }
  })

  it('collapses a repeated tier to one', () => {
    const result = parseSyncSnapshot({
      ...valid,
      diaries: { tiers: ['ardougne-easy', 'ardougne-easy'] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.diaries?.tiers).toEqual(['ardougne-easy'])
    }
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'ardougne-easy'],
    ['a missing tier list', {}],
    ['a tier list that is not an array', { tiers: 'ardougne-easy' }],
    ['a non-string tier id', { tiers: [1] }],
    ['a non-kebab-case tier id', { tiers: ['Ardougne Easy'] }],
    ['an over-long tier id', { tiers: ['a'.repeat(65)] }],
  ])('rejects %s', (_label, diaries) => {
    expect(parseSyncSnapshot({ ...valid, diaries }).ok).toBe(false)
  })

  it('rejects more tiers than the dataset could ever have', () => {
    const tiers = Array.from({ length: 101 }, (_, i) => `tier-${i}`)
    expect(parseSyncSnapshot({ ...valid, diaries: { tiers } }).ok).toBe(false)
  })

  // Refuses whole rather than salvaging the valid tiers: a partial snapshot
  // that looks successful gets merged and believed.
  it('refuses a list with one bad id rather than keeping the rest', () => {
    const result = parseSyncSnapshot({
      ...valid,
      diaries: { tiers: ['ardougne-easy', 'NOT VALID'] },
    })
    expect(result.ok).toBe(false)
  })
})

describe('parseStoredSnapshot', () => {
  it('requires the server-assigned timestamp', () => {
    expect(parseStoredSnapshot(valid).ok).toBe(false)
  })

  it('rejects a timestamp that is not a date', () => {
    expect(parseStoredSnapshot({ ...valid, receivedAt: 'yesterday' }).ok).toBe(
      false,
    )
  })

  it('accepts a snapshot carrying one', () => {
    const result = parseStoredSnapshot({
      ...valid,
      receivedAt: '2026-09-16T12:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.receivedAt).toBe('2026-09-16T12:00:00.000Z')
    }
  })
})

describe('reconcileSnapshot', () => {
  it('keeps known ids and reports the rest as drift', () => {
    const { progress, unknownIds } = reconcileSnapshot(
      {
        schemaVersion: SYNC_SCHEMA_VERSION,
        accountHash: '1',
        quests: { 'cooks-assistant': 'done', 'not-a-quest': 'done' },
      },
      new Set(['cooks-assistant']),
    )

    expect(progress).toEqual({ 'cooks-assistant': 'done' })
    expect(unknownIds).toEqual(['not-a-quest'])
  })
})

describe('reconcileTiers', () => {
  const snapshot = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    accountHash: '1',
    quests: {},
    diaries: { tiers: ['ardougne-easy', 'atlantis-easy'] },
  }

  it('keeps known tiers and reports the rest as drift', () => {
    expect(reconcileTiers(snapshot, new Set(['ardougne-easy']))).toEqual({
      tiers: ['ardougne-easy'],
      unknownIds: ['atlantis-easy'],
    })
  })

  // A snapshot cached before diaries existed has no such key at all.
  it('tolerates a snapshot with no diaries', () => {
    const old = {
      schemaVersion: SYNC_SCHEMA_VERSION,
      accountHash: '1',
      quests: {},
    }
    expect(reconcileTiers(old, new Set(['ardougne-easy']))).toEqual({
      tiers: [],
      unknownIds: [],
    })
  })
})

describe('isBelowSynced', () => {
  // The options the merge would silently override: picking one edits the
  // local record and the display doesn't move.
  it('locks every option below a synced done', () => {
    expect(isBelowSynced('todo', 'done')).toBe(true)
    expect(isBelowSynced('doing', 'done')).toBe(true)
  })

  it('leaves the synced state itself and anything above it open', () => {
    expect(isBelowSynced('done', 'done')).toBe(false)
    expect(isBelowSynced('doing', 'doing')).toBe(false)
    expect(isBelowSynced('done', 'doing')).toBe(false)
  })

  it('locks only todo below a synced doing', () => {
    expect(isBelowSynced('todo', 'doing')).toBe(true)
  })

  it('locks nothing when the snapshot says nothing', () => {
    for (const option of ['todo', 'doing', 'done'] as const) {
      expect(isBelowSynced(option, 'todo')).toBe(false)
    }
  })

  // Agrees with the merge: an option is locked exactly when choosing it could
  // not change the merged result.
  it('matches mergeProgress for every pair', () => {
    const states = ['todo', 'doing', 'done'] as const
    for (const synced of states) {
      for (const option of states) {
        const shown = mergeProgress({ q: option }, { q: synced }).q
        const changesDisplay = shown === option
        expect(isBelowSynced(option, synced)).toBe(!changesDisplay)
      }
    }
  })
})

describe('mergeProgress', () => {
  it('promotes a quest the player has not recorded', () => {
    expect(mergeProgress({}, { a: 'done' })).toEqual({ a: 'done' })
  })

  it('promotes doing to done', () => {
    expect(mergeProgress({ a: 'doing' }, { a: 'done' }).a).toBe('done')
  })

  // The safety property the whole design rests on: a snapshot can move a quest
  // forwards and never backwards, which is what makes the toggle a full undo.
  it('never demotes what the player recorded', () => {
    expect(mergeProgress({ a: 'done' }, { a: 'doing' }).a).toBe('done')
    expect(mergeProgress({ a: 'doing' }, { a: 'todo' }).a).toBe('doing')
  })

  it('keeps entries the snapshot says nothing about', () => {
    expect(mergeProgress({ b: 'doing' }, { a: 'done' })).toEqual({
      a: 'done',
      b: 'doing',
    })
  })

  it('does not mutate the player’s own progress', () => {
    const local = { a: 'done' } as const
    mergeProgress(local, { a: 'doing', c: 'done' })
    expect(local).toEqual({ a: 'done' })
  })
})
