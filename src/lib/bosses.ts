/**
 * Joining hiscore kill counts onto the boss dataset.
 *
 * Pure: no DOM, no network. The dataset itself is generated
 * (`scripts/build-bosses.ts` → `src/data/bosses.json`) and this file does not
 * import it — callers pass it in, so the ~144 KB of JSON stays behind the
 * store's dynamic import and out of the entry chunk.
 *
 * **Names are the join key. Ids are not.** The hiscores' boss block is ordered
 * roughly alphabetically, so Jagex inserts new bosses in the middle and
 * renumbers everything after them — `Amoxliatl` sits between `Alchemical
 * Hydra` and `Araxxor` and pushed 68 rows along by one. Matching on position
 * would attribute one boss's kills to another after any release, which is the
 * worst failure available here: plausible numbers against the wrong name.
 *
 * This file used to carry the boss list by hand. It doesn't any more — the
 * generator resolves the hiscores' own names against the wiki, so the list
 * refreshes with the dataset instead of waiting for someone to notice. What
 * survives is the arithmetic and the three-state honesty below.
 */
import type { ActivityEntry, Boss } from './types'

/**
 * The hiscore activity rows that are not bosses: points, clues, minigames and
 * ranks.
 *
 * The one hand-maintained list left, and it earns its place by being the thing
 * the generator *subtracts*: everything in the activities array that isn't
 * here is treated as a boss and must resolve to a wiki page, so a newly
 * released boss needs no edit anywhere. The failure direction is deliberate —
 * a new non-boss row (another clue tier, say) fails to resolve and becomes a
 * defect a human reads, rather than silently joining the boss list.
 *
 * Verified against a live `index_lite.json` response on 2026-09-21: 91
 * activities, these 20 and 71 bosses.
 */
export const OTHER_ACTIVITY_NAMES: readonly string[] = [
  'Grid Points',
  'League Points',
  'Deadman Points',
  'Bounty Hunter - Hunter',
  'Bounty Hunter - Rogue',
  'Bounty Hunter (Legacy) - Hunter',
  'Bounty Hunter (Legacy) - Rogue',
  'Clue Scrolls (all)',
  'Clue Scrolls (beginner)',
  'Clue Scrolls (easy)',
  'Clue Scrolls (medium)',
  'Clue Scrolls (hard)',
  'Clue Scrolls (elite)',
  'Clue Scrolls (master)',
  'LMS - Rank',
  'PvP Arena - Rank',
  'Soul Wars Zeal',
  'Rifts closed',
  'Colosseum Glory',
  'Collections Logged',
]

/**
 * A boss with whatever the hiscores say about the player's kills.
 *
 * There are **three states and they are not interchangeable**, which is what
 * this type exists to keep straight:
 *
 *   tracked false            → the hiscores publish no count for this boss at
 *                              all, and for most of them no count exists
 *                              anywhere: Akkha is a room inside Tombs of
 *                              Amascut, Agrith Naar is killed once in a quest.
 *                              112 of the 183 bosses are in this state.
 *   tracked, not ranked      → a count exists but this player isn't on the
 *                              board. That means *unknown*, not zero — Jagex
 *                              publishes nothing below its rank cutoff, so a
 *                              player with a handful of kills can look exactly
 *                              like one with none.
 *   tracked, ranked          → `kills` is real, and may legitimately be 0. The
 *                              live response returns `rank -1, score 0` for
 *                              `Brutus`, `Mad Angel` and `Maggot King`.
 *
 * Rendering any two of those the same way states something the hiscores never
 * said.
 */
export interface BossRow {
  boss: Boss
  /** Kill count, or null when none is published. */
  kills: number | null
  /** Hiscore position, or null when unranked. */
  rank: number | null
  /** True when the hiscores published a count — including a count of zero. */
  ranked: boolean
  /** True when the hiscores track this boss for anyone at all. */
  tracked: boolean
}

/**
 * Every boss in the dataset, with kill counts joined on by hiscore name.
 *
 * Nothing is dropped: a boss the hiscores don't track still appears, because
 * the list is a reference as well as a tracker and 112 of the entries only
 * exist in the first sense.
 */
export function buildBossRows(
  bosses: readonly Boss[],
  activities: readonly ActivityEntry[],
): BossRow[] {
  const byName = new Map<string, ActivityEntry>()
  for (const entry of activities) byName.set(entry.name, entry)

  return bosses.map((boss) => {
    const entry = boss.hiscoreName ? byName.get(boss.hiscoreName) : undefined
    const kills = entry?.score ?? null
    return {
      boss,
      kills,
      rank: entry?.rank ?? null,
      ranked: kills !== null,
      tracked: boss.hiscoreName !== null,
    }
  })
}

/**
 * Most-killed first, then tracked-but-unranked, then the untracked.
 *
 * The three groups sort in descending order of how much the hiscores know, so
 * the rows that answer "what have I killed" come first and the reference-only
 * entries settle at the bottom without being hidden. Alphabetical within a
 * group, so the order is stable rather than dependent on dataset order.
 */
export function sortByKills(rows: readonly BossRow[]): BossRow[] {
  const group = (row: BossRow): number => (row.ranked ? 0 : row.tracked ? 1 : 2)

  return [...rows].sort((a, b) => {
    const groups = group(a) - group(b)
    if (groups !== 0) return groups
    if (a.ranked && b.ranked && a.kills !== b.kills)
      return (b.kills ?? 0) - (a.kills ?? 0)
    return a.boss.name.localeCompare(b.boss.name)
  })
}

/** Plain alphabetical, for browsing the list as a reference. */
export function sortByName(rows: readonly BossRow[]): BossRow[] {
  return [...rows].sort((a, b) => a.boss.name.localeCompare(b.boss.name))
}

/**
 * Activity names the hiscores returned that nothing accounts for.
 *
 * The drift report, and the reason `OTHER_ACTIVITY_NAMES` is enumerated. A
 * boss released today appears in the hiscores immediately and in our dataset
 * only after `build:bosses` runs, so this is what stands between that gap and
 * silence. Same role as the diary store's `syncUnknownTierIds`: surface the
 * disagreement rather than absorb it.
 *
 * Expect it to be empty. When it isn't, run `npm run build:bosses -- --refresh`.
 */
export function unclassifiedActivities(
  activities: readonly ActivityEntry[],
  bosses: readonly Boss[],
): string[] {
  const known = new Set<string>(OTHER_ACTIVITY_NAMES)
  for (const boss of bosses) {
    if (boss.hiscoreName) known.add(boss.hiscoreName)
  }
  return activities
    .map((entry) => entry.name)
    .filter((name) => !known.has(name))
}

/** Headline counts for the panel's summary line. */
export interface BossTotals {
  /** Bosses with a published count above zero. */
  killed: number
  /** Bosses the hiscores publish a count for at all. */
  tracked: number
  /** Bosses in the list, tracked or not. */
  total: number
  /** Sum of every published kill count. */
  kills: number
}

export function bossTotals(rows: readonly BossRow[]): BossTotals {
  let killed = 0
  let tracked = 0
  let kills = 0
  for (const row of rows) {
    if (row.tracked) tracked++
    if (row.kills && row.kills > 0) killed++
    kills += row.kills ?? 0
  }
  return { killed, tracked, total: rows.length, kills }
}
