/**
 * `src/lib/sync.ts` guards the one boundary in this app where untrusted input
 * meets data that can't be recovered. These tests are mostly about what it
 * *refuses*, since accepting a malformed snapshot is the failure that matters
 * — a rejected one is visible, a half-parsed one gets merged and believed.
 */
import { describe, expect, it } from 'vitest'
import {
  mergeProgress,
  parseStoredSnapshot,
  parseSyncSnapshot,
  reconcileSnapshot,
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
