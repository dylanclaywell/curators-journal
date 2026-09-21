/**
 * The boss list reads someone else's array, so the failures worth testing are
 * the ones where a plausible-looking number ends up against the wrong name, or
 * where "we don't know" is rendered as "zero":
 *
 *   - unranked (score -1) must not collapse into a real zero (score 0), which
 *     the live hiscores really do return for some bosses;
 *   - a boss missing from the response must still appear, so the list doesn't
 *     change length with the account type;
 *   - a name we don't classify must be reported, not absorbed — that report is
 *     the only way a hand-maintained list learns Jagex shipped a boss;
 *   - the two name lists must not overlap or the classification is ambiguous.
 */
import { describe, expect, it } from 'vitest'
import {
  BOSS_NAMES,
  OTHER_ACTIVITY_NAMES,
  bossTotals,
  buildBossRows,
  classifyActivity,
  sortByKills,
  unclassifiedActivities,
} from '../src/lib/bosses'
import type { ActivityEntry } from '../src/lib/types'

/** Mirrors the parser's output: null for the -1 the hiscores send. */
const entry = (
  name: string,
  score: number | null,
  rank: number | null = null,
): ActivityEntry => ({ name, score, rank })

describe('the name lists', () => {
  it('do not overlap', () => {
    const others = new Set(OTHER_ACTIVITY_NAMES)
    expect(BOSS_NAMES.filter((name) => others.has(name))).toEqual([])
  })

  it('contain no duplicates', () => {
    expect(new Set(BOSS_NAMES).size).toBe(BOSS_NAMES.length)
    expect(new Set(OTHER_ACTIVITY_NAMES).size).toBe(OTHER_ACTIVITY_NAMES.length)
  })

  it('match the 91 activities the live response carried', () => {
    expect(BOSS_NAMES.length + OTHER_ACTIVITY_NAMES.length).toBe(91)
  })

  it('classify each list correctly, and nothing else', () => {
    expect(classifyActivity('Zulrah')).toBe('boss')
    expect(classifyActivity('Clue Scrolls (all)')).toBe('other')
    expect(classifyActivity('Some Boss Released Tomorrow')).toBe('unknown')
  })

  it('classifies by exact name, so punctuation is load-bearing', () => {
    expect(classifyActivity("K'ril Tsutsaroth")).toBe('boss')
    expect(classifyActivity('Kril Tsutsaroth')).toBe('unknown')
  })
})

describe('buildBossRows', () => {
  it('keeps unranked and zero apart', () => {
    const rows = buildBossRows([
      entry('Zulrah', null, null),
      entry('Brutus', 0, null),
      entry('Vorkath', 12, 40000),
    ])
    const byName = new Map(rows.map((row) => [row.name, row]))

    // Unranked: no count was published, which is not a count of zero.
    expect(byName.get('Zulrah')).toMatchObject({ kills: null, ranked: false })
    // Published zero: the hiscores really do return this.
    expect(byName.get('Brutus')).toMatchObject({ kills: 0, ranked: true })
    expect(byName.get('Vorkath')).toMatchObject({ kills: 12, ranked: true })
  })

  it('includes bosses the response left out entirely', () => {
    const rows = buildBossRows([entry('Vorkath', 12, 40000)])
    expect(rows).toHaveLength(BOSS_NAMES.length)
    expect(rows.find((row) => row.name === 'Zulrah')).toMatchObject({
      kills: null,
      ranked: false,
    })
  })

  it('ignores rows it does not classify as bosses', () => {
    const rows = buildBossRows([
      entry('Clue Scrolls (all)', 22, 1141204),
      entry('Some Boss Released Tomorrow', 5, 1),
    ])
    expect(rows.map((row) => row.name)).not.toContain('Clue Scrolls (all)')
    expect(rows.map((row) => row.name)).not.toContain(
      'Some Boss Released Tomorrow',
    )
  })
})

describe('sortByKills', () => {
  it('puts the most-killed first and the unranked last', () => {
    const rows = sortByKills([
      { name: 'Unranked', kills: null, rank: null, ranked: false },
      { name: 'Zero', kills: 0, rank: null, ranked: true },
      { name: 'Many', kills: 900, rank: 5, ranked: true },
      { name: 'Few', kills: 3, rank: 900, ranked: true },
    ])
    expect(rows.map((row) => row.name)).toEqual([
      'Many',
      'Few',
      'Zero',
      'Unranked',
    ])
  })

  it('breaks ties alphabetically rather than by input order', () => {
    const rows = sortByKills([
      { name: 'Zulrah', kills: 10, rank: 1, ranked: true },
      { name: 'Araxxor', kills: 10, rank: 2, ranked: true },
    ])
    expect(rows.map((row) => row.name)).toEqual(['Araxxor', 'Zulrah'])
  })

  it('does not mutate its input', () => {
    const input = [
      { name: 'Araxxor', kills: 1, rank: 1, ranked: true },
      { name: 'Zulrah', kills: 9, rank: 1, ranked: true },
    ]
    sortByKills(input)
    expect(input.map((row) => row.name)).toEqual(['Araxxor', 'Zulrah'])
  })
})

describe('unclassifiedActivities', () => {
  it('reports names in neither list', () => {
    expect(
      unclassifiedActivities([
        entry('Zulrah', 5),
        entry('Clue Scrolls (all)', 22),
        entry('Some Boss Released Tomorrow', null),
      ]),
    ).toEqual(['Some Boss Released Tomorrow'])
  })

  it('is empty for a response carrying only known names', () => {
    const activities = [...BOSS_NAMES, ...OTHER_ACTIVITY_NAMES].map((name) =>
      entry(name, null),
    )
    expect(unclassifiedActivities(activities)).toEqual([])
  })
})

describe('bossTotals', () => {
  it('counts only bosses with kills, and sums published counts', () => {
    const totals = bossTotals([
      { name: 'Many', kills: 900, rank: 5, ranked: true },
      { name: 'Few', kills: 3, rank: 900, ranked: true },
      { name: 'Zero', kills: 0, rank: null, ranked: true },
      { name: 'Unranked', kills: null, rank: null, ranked: false },
    ])
    expect(totals).toEqual({ killed: 2, total: 4, kills: 903 })
  })
})
