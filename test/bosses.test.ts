/**
 * The boss list joins someone else's array onto a generated dataset, so the
 * failures worth testing are the ones where a plausible number ends up against
 * the wrong name, or where "we don't know" is rendered as "zero":
 *
 *   - the three states (untracked / tracked-but-unscored / scored) must stay
 *     apart, including the real zero the live hiscores return, and `scored`
 *     must not be confused with having a rank — the hiscores publish a score
 *     from the first kill but a rank only after about five;
 *   - a boss the hiscores don't track must still appear, because 112 of the
 *     183 only exist as reference;
 *   - an activity name nothing accounts for must be reported, since that is
 *     the only signal that a boss shipped since the dataset was generated.
 *
 * The last block checks the committed dataset itself. Those are invariants the
 * generator promises and the UI relies on — unique ids, variants pointing at a
 * real parent, every hiscore row placed — and they are cheap to assert here
 * and expensive to notice in a panel.
 */
import { describe, expect, it } from 'vitest'
import {
  OTHER_ACTIVITY_NAMES,
  bossTotals,
  buildBossRows,
  sortByKills,
  sortByName,
  unclassifiedActivities,
} from '../src/lib/bosses'
import dataset from '../src/data/bosses.json' with { type: 'json' }
import type { ActivityEntry, Boss, BossDataset } from '../src/lib/types'

const bosses = (dataset as BossDataset).bosses

/** Mirrors the parser's output: null for the -1 the hiscores send. */
const entry = (
  name: string,
  score: number | null,
  rank: number | null = null,
): ActivityEntry => ({ name, score, rank })

const boss = (name: string, hiscoreName: string | null): Boss => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  page: name,
  wikiUrl: `https://oldschool.runescape.wiki/w/${name}`,
  members: true,
  hiscoreName,
  variantOf: null,
  examine: null,
  slayerCategories: [],
  versions: [],
})

describe('buildBossRows', () => {
  it('keeps the three states apart', () => {
    const rows = buildBossRows(
      [
        boss('Zulrah', 'Zulrah'),
        boss('Brutus', 'Brutus'),
        boss('Vorkath', 'Vorkath'),
        boss('Akkha', null),
      ],
      [
        entry('Zulrah', null, null),
        entry('Brutus', 0, null),
        entry('Vorkath', 12, 40000),
      ],
    )
    const byName = new Map(rows.map((row) => [row.boss.name, row]))

    // Tracked, no score: zero kills. Every boss appears from the first kill,
    // so this is an answer rather than a gap.
    expect(byName.get('Zulrah')).toMatchObject({
      kills: null,
      scored: false,
      tracked: true,
    })
    // A published zero. The live hiscores really do return this.
    expect(byName.get('Brutus')).toMatchObject({ kills: 0, scored: true })
    expect(byName.get('Vorkath')).toMatchObject({ kills: 12, scored: true })
    // Not tracked at all: no count exists for anyone, anywhere.
    expect(byName.get('Akkha')).toMatchObject({
      kills: null,
      scored: false,
      tracked: false,
    })
  })

  it('keeps bosses the response said nothing about', () => {
    const rows = buildBossRows([boss('Zulrah', 'Zulrah')], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kills: null, scored: false, tracked: true })
  })

  it('ignores activity rows that are not bosses', () => {
    const rows = buildBossRows(
      [boss('Zulrah', 'Zulrah')],
      [entry('Clue Scrolls (all)', 22, 1141204), entry('Zulrah', 3, 900)],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kills).toBe(3)
  })

  it('joins on the hiscore name, not the boss name', () => {
    // The hiscores file Barrows under "Barrows Chests"; the wiki page is
    // "Barrows". Joining on the display name would lose the count.
    const rows = buildBossRows(
      [boss('Barrows', 'Barrows Chests')],
      [entry('Barrows Chests', 41, 500000)],
    )
    expect(rows[0].kills).toBe(41)
  })
})

describe('sortByKills', () => {
  it('orders by how much the hiscores know, then by kills', () => {
    const rows = sortByKills(
      buildBossRows(
        [
          boss('Untracked', null),
          boss('NeverKilled', 'NeverKilled'),
          boss('Zero', 'Zero'),
          boss('Many', 'Many'),
          boss('Few', 'Few'),
        ],
        [
          entry('NeverKilled', null),
          entry('Zero', 0),
          entry('Many', 900, 5),
          entry('Few', 3, 900),
        ],
      ),
    )
    expect(rows.map((row) => row.boss.name)).toEqual([
      'Many',
      'Few',
      'Zero',
      'NeverKilled',
      'Untracked',
    ])
  })

  it('breaks ties alphabetically rather than by dataset order', () => {
    const rows = sortByKills(
      buildBossRows(
        [boss('Zulrah', 'Zulrah'), boss('Araxxor', 'Araxxor')],
        [entry('Zulrah', 10, 1), entry('Araxxor', 10, 2)],
      ),
    )
    expect(rows.map((row) => row.boss.name)).toEqual(['Araxxor', 'Zulrah'])
  })

  it('does not mutate its input', () => {
    const rows = buildBossRows(
      [boss('Zulrah', 'Zulrah'), boss('Araxxor', 'Araxxor')],
      [entry('Zulrah', 10, 1)],
    )
    sortByKills(rows)
    expect(rows.map((row) => row.boss.name)).toEqual(['Zulrah', 'Araxxor'])
  })
})

describe('sortByName', () => {
  it('ignores kill counts entirely', () => {
    const rows = sortByName(
      buildBossRows(
        [boss('Zulrah', 'Zulrah'), boss('Araxxor', null)],
        [entry('Zulrah', 999, 1)],
      ),
    )
    expect(rows.map((row) => row.boss.name)).toEqual(['Araxxor', 'Zulrah'])
  })
})

describe('unclassifiedActivities', () => {
  it('reports names nothing accounts for', () => {
    expect(
      unclassifiedActivities(
        [
          entry('Zulrah', 5),
          entry('Clue Scrolls (all)', 22),
          entry('Some Boss Released Tomorrow', null),
        ],
        [boss('Zulrah', 'Zulrah')],
      ),
    ).toEqual(['Some Boss Released Tomorrow'])
  })

  it('is empty for the live activity names the dataset was built from', () => {
    const live = [
      ...OTHER_ACTIVITY_NAMES,
      ...bosses
        .map((b) => b.hiscoreName)
        .filter((n): n is string => n !== null),
    ].map((name) => entry(name, null))

    expect(unclassifiedActivities(live, bosses)).toEqual([])
  })
})

describe('bossTotals', () => {
  it('separates tracked from killed', () => {
    const totals = bossTotals(
      buildBossRows(
        [
          boss('Many', 'Many'),
          boss('Few', 'Few'),
          boss('Zero', 'Zero'),
          boss('NeverKilled', 'NeverKilled'),
          boss('Untracked', null),
        ],
        [
          entry('Many', 900, 5),
          entry('Few', 3, 900),
          entry('Zero', 0),
          entry('NeverKilled', null),
        ],
      ),
    )
    expect(totals).toEqual({ killed: 2, tracked: 4, total: 5, kills: 903 })
  })
})

describe('the committed dataset', () => {
  it('accounts for all 91 hiscore activities', () => {
    // The tripwire the old hand-written list provided: 71 boss rows plus the
    // 20 non-boss rows is the whole activities array. If Jagex adds one, this
    // is where it shows up.
    const tracked = bosses.filter((b) => b.hiscoreName !== null)
    expect(tracked).toHaveLength(71)
    expect(tracked.length + OTHER_ACTIVITY_NAMES.length).toBe(91)
  })

  it('has unique ids', () => {
    const ids = bosses.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique hiscore names, so no count lands twice', () => {
    const names = bosses
      .map((b) => b.hiscoreName)
      .filter((n): n is string => n !== null)
    expect(new Set(names).size).toBe(names.length)
  })

  it('points every variant at a boss that exists', () => {
    const ids = new Set(bosses.map((b) => b.id))
    for (const b of bosses) {
      if (b.variantOf === null) continue
      expect(ids.has(b.variantOf), `${b.id} -> ${b.variantOf}`).toBe(true)
    }
  })

  it('gives every variant its own hiscore count', () => {
    // A variant exists *because* the hiscores count it separately from the
    // page it shares. One without a count would just be a duplicate row.
    for (const b of bosses) {
      if (b.variantOf === null) continue
      expect(b.hiscoreName, b.id).not.toBeNull()
    }
  })

  it('carries both of Vorkath’s versions rather than picking one', () => {
    const vorkath = bosses.find((b) => b.id === 'vorkath')
    expect(vorkath?.versions).toHaveLength(2)
    expect(vorkath?.versions.map((v) => v.combatLevel)).toEqual([732, 392])
  })
})
