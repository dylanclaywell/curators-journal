/**
 * Export/import is the recovery path for data with no other source, so the
 * cases that matter are the ones where a file is *older* or *stranger* than
 * the code reading it. A backup that refuses to import is the failure this is
 * guarding against, not a malformed one that gets rejected loudly.
 */
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup } from '../src/lib/backup'

const input = {
  username: 'zezima',
  accountType: 'normal' as const,
  progress: { 'cooks-assistant': 'done' as const },
  goals: ['dragon-slayer-i'],
  accountHash: '1234567890',
  mergeEnabled: true,
}

describe('createBackup', () => {
  it('round-trips through parseBackup', () => {
    const result = parseBackup(JSON.parse(JSON.stringify(createBackup(input))))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.backup.settings.username).toBe('zezima')
    expect(result.backup.quests.progress).toEqual({
      'cooks-assistant': 'done',
    })
    expect(result.backup.quests.goals).toEqual(['dragon-slayer-i'])
    expect(result.backup.sync).toEqual({
      accountHash: '1234567890',
      mergeEnabled: true,
    })
  })

  it('copies rather than aliasing the caller’s objects', () => {
    const progress = { 'cooks-assistant': 'done' as const }
    const goals = ['dragon-slayer-i']
    const backup = createBackup({ ...input, progress, goals })

    delete (progress as Record<string, unknown>)['cooks-assistant']
    goals.pop()

    expect(backup.quests.progress).toEqual({ 'cooks-assistant': 'done' })
    expect(backup.quests.goals).toEqual(['dragon-slayer-i'])
  })
})

describe('parseBackup', () => {
  it('accepts a pre-Phase-5 backup with no sync block', () => {
    const backup = createBackup(input) as Record<string, unknown>
    delete backup.sync

    const result = parseBackup(backup)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.sync).toBeUndefined()
  })

  it('still accepts a backup written under the old app slug', () => {
    const backup = { ...createBackup(input), app: 'stagescape' }
    expect(parseBackup(backup).ok).toBe(true)
  })

  it.each([
    ['sync that is not an object', 'nope'],
    ['a non-string account hash', { accountHash: 1, mergeEnabled: true }],
    ['a missing mergeEnabled', { accountHash: '1' }],
    ['a non-boolean mergeEnabled', { accountHash: '1', mergeEnabled: 'yes' }],
    ['null sync', null],
  ])('rejects %s', (_label, sync) => {
    const result = parseBackup({ ...createBackup(input), sync })
    expect(result.ok).toBe(false)
  })

  it.each([
    ['a foreign file', { app: 'something-else', version: 1 }],
    ['an unsupported version', { ...createBackup(input), version: 2 }],
    ['missing settings', { ...createBackup(input), settings: undefined }],
    [
      'an unknown account type',
      {
        ...createBackup(input),
        settings: { username: 'x', accountType: 'wizard' },
      },
    ],
    [
      'an invalid progress state',
      {
        ...createBackup(input),
        quests: { progress: { a: 'finished' }, goals: [] },
      },
    ],
    [
      'goals that are not strings',
      {
        ...createBackup(input),
        quests: { progress: {}, goals: [1, 2] },
      },
    ],
  ])('rejects %s', (_label, backup) => {
    expect(parseBackup(backup).ok).toBe(false)
  })
})
