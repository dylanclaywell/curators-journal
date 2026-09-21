/**
 * Joining hiscore kill counts onto the boss dataset.
 *
 * Pure: no DOM, no network. The dataset itself is generated
 * (`scripts/build-bosses.ts` -> `src/data/bosses.json`) and this file does not
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
 * **Score and rank are different things, and conflating them is the trap.**
 * The wiki is explicit: a score means the player has recorded kills, while a
 * rank "is only assigned once that kill count is high enough relative to other
 * players", which typically takes 5 kills. So a player can have a score and no
 * rank, and the live response does exactly that — `Brutus` comes back
 * `rank: -1, score: 0`. `scored` is therefore named for the hiscores' own
 * field, not for the leaderboard.
 *
 * Three states, not interchangeable:
 *
 *   tracked false      the hiscores publish no count for this boss at all,
 *                      and for most of them no count exists anywhere: Akkha
 *                      is a room inside Tombs of Amascut, Agrith Naar is
 *                      killed once in a quest. 112 of the 183 are here, and
 *                      no third-party API fills the gap (measured — see
 *                      ROADMAP.md Phase 7).
 *   tracked, unscored  **zero kills.** Every boss and activity now appears
 *                      from the first kill, so an absent score is a real
 *                      answer rather than a gap. This was not always true:
 *                      Jagex set the minimum to 50 when boss hiscores
 *                      launched in 2019 and lowered it in stages, so older
 *                      notes claiming "unranked means unknown" describe a
 *                      version of the hiscores that no longer exists.
 *   tracked, scored    `kills` is real and may legitimately be 0.
 *
 * `rank` is independent of all three and is null far more often than `kills`
 * is — that is normal, not missing data.
 */
export interface BossRow {
  boss: Boss
  /** Kill count, or null when the player has never killed this boss. */
  kills: number | null
  /**
   * Leaderboard position, or null when the player has kills but not enough to
   * place. Null here says nothing about whether `kills` is known.
   */
  rank: number | null
  /** True when the hiscores publish a Score — so, from the first kill. */
  scored: boolean
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
      scored: kills !== null,
      tracked: boss.hiscoreName !== null,
    }
  })
}

/**
 * Most-killed first, then the never-killed, then the untracked.
 *
 * The three groups sort in descending order of how much the hiscores know, so
 * the rows that answer "what have I killed" come first and the reference-only
 * entries settle at the bottom without being hidden. Alphabetical within a
 * group, so the order is stable rather than dependent on dataset order.
 */
export function sortByKills(rows: readonly BossRow[]): BossRow[] {
  const group = (row: BossRow): number => (row.scored ? 0 : row.tracked ? 1 : 2)

  return [...rows].sort((a, b) => {
    const groups = group(a) - group(b)
    if (groups !== 0) return groups
    if (a.scored && b.scored && a.kills !== b.kills)
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
