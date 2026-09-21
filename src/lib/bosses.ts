/**
 * Boss kill counts, read out of the hiscores activity array.
 *
 * Pure: no DOM, no network. The one piece of data here is a classification of
 * hiscore *activity names* — which of them are bosses and which are the clue,
 * minigame and points rows that share the same array.
 *
 * Nothing in this file is fetched or generated. Unlike quests and diaries, the
 * source here is the hiscores response itself, which the app already fetches,
 * caches and refreshes for the skills grid. A boss panel is a display problem
 * on data we have, not a new dataset — see ROADMAP.md Phase 7.
 *
 * **Names are the join key. Ids are not.** The boss block is ordered roughly
 * alphabetically, so Jagex inserts new bosses in the middle and renumbers
 * everything after them — `Amoxliatl` sits at id 22, between `Alchemical
 * Hydra` and `Araxxor`, and pushed all 68 rows below it along by one. Matching
 * on id would silently attribute one boss's kills to another after any
 * release, which is the worst failure this file could have: plausible numbers
 * against the wrong name. So the lists below are names, the lookup is by name,
 * and a persisted id never appears anywhere.
 */
import type { ActivityEntry } from './types'

/**
 * The non-boss rows: points, clues, minigames and ranks. Kept as an explicit
 * list rather than inferred, because the *only* way to notice that Jagex added
 * something is to find a name that is in neither list — see
 * `unclassifiedActivities`. An "everything we don't recognise is a boss" rule
 * would swallow a new clue tier and show it as a boss with a kill count.
 *
 * Verified against a live `index_lite.json` response on 2026-09-21: 91
 * activities, these 20 first, the 71 bosses after them.
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
 * The boss block, in the response's own order.
 *
 * "Boss" here means "Jagex files it in the boss section of the hiscores",
 * which is the only definition that can be checked against anything. It is
 * looser than the word usually is in game: Barrows and Lunar Chests are chest
 * counts, the raids are team encounters counted per completion, and Tempoross,
 * Wintertodt, Zalcano and Hespori are skilling content. They are all in the
 * block, they are all things a player has a count of, and inventing our own
 * stricter line would mean hiding rows the hiscores show.
 */
export const BOSS_NAMES: readonly string[] = [
  'Abyssal Sire',
  'Alchemical Hydra',
  'Amoxliatl',
  'Araxxor',
  'Artio',
  'Barrows Chests',
  'Brutus',
  'Bryophyta',
  'Callisto',
  "Calvar'ion",
  'Cerberus',
  'Chambers of Xeric',
  'Chambers of Xeric: Challenge Mode',
  'Chaos Elemental',
  'Chaos Fanatic',
  'Commander Zilyana',
  'Corporeal Beast',
  'Crazy Archaeologist',
  'Dagannoth Prime',
  'Dagannoth Rex',
  'Dagannoth Supreme',
  'Deranged Archaeologist',
  'Doom of Mokhaiotl',
  'Duke Sucellus',
  'General Graardor',
  'Giant Mole',
  'Grotesque Guardians',
  'Hespori',
  'Kalphite Queen',
  'King Black Dragon',
  'Kraken',
  "Kree'Arra",
  "K'ril Tsutsaroth",
  'Lunar Chests',
  'Mad Angel',
  'Maggot King',
  'Mimic',
  'Nex',
  'Nightmare',
  "Phosani's Nightmare",
  'Obor',
  'Phantom Muspah',
  'Sarachnis',
  'Scorpia',
  'Scurrius',
  'Shellbane Gryphon',
  'Skotizo',
  'Sol Heredit',
  'Spindel',
  'Tempoross',
  'The Gauntlet',
  'The Corrupted Gauntlet',
  'The Hueycoatl',
  'The Leviathan',
  'The Royal Titans',
  'The Whisperer',
  'Theatre of Blood',
  'Theatre of Blood: Hard Mode',
  'Thermonuclear Smoke Devil',
  'Tombs of Amascut',
  'Tombs of Amascut: Expert Mode',
  'TzKal-Zuk',
  'TzTok-Jad',
  'Vardorvis',
  'Venenatis',
  "Vet'ion",
  'Vorkath',
  'Wintertodt',
  'Yama',
  'Zalcano',
  'Zulrah',
]

const BOSS_SET = new Set(BOSS_NAMES)
const OTHER_SET = new Set(OTHER_ACTIVITY_NAMES)

export type ActivityKind = 'boss' | 'other' | 'unknown'

export function classifyActivity(name: string): ActivityKind {
  if (BOSS_SET.has(name)) return 'boss'
  if (OTHER_SET.has(name)) return 'other'
  return 'unknown'
}

/**
 * A boss row ready to render.
 *
 * `kills` and `rank` are both nullable and they are **not** interchangeable,
 * which is the subtlety this whole type exists to carry. The hiscores
 * distinguish three states, and the response really does contain all three:
 *
 *   rank -1, score -1  → unranked. No count published at all.
 *   rank -1, score  0  → on the board, zero kills. Observed on `Brutus`,
 *                        `Mad Angel` and `Maggot King`.
 *   rank  n, score  k  → ranked, k kills.
 *
 * Rendering the first two identically as "0" would state something the
 * hiscores never said. Unranked means *unknown*, not zero — Jagex publishes no
 * count below its rank cutoff, so a player with a handful of kills can look
 * exactly like one with none.
 */
export interface BossRow {
  name: string
  /** Kill count, or null when the hiscores publish none for this player. */
  kills: number | null
  /** Hiscore position, or null when unranked. */
  rank: number | null
  /** True when the hiscores published a count — including a count of zero. */
  ranked: boolean
}

/**
 * Every boss we know about, whether or not the response carried a row for it.
 *
 * A boss missing from the response comes back unranked rather than being
 * dropped, so the list has a stable length and a stable membership regardless
 * of account type or what Jagex returned. A row the response carries but we
 * don't classify is *not* here — it is reported separately, by
 * `unclassifiedActivities`, so new content surfaces as a finding instead of
 * quietly appearing in the list unstyled and unsorted.
 */
export function buildBossRows(activities: readonly ActivityEntry[]): BossRow[] {
  const byName = new Map<string, ActivityEntry>()
  for (const entry of activities) byName.set(entry.name, entry)

  return BOSS_NAMES.map((name) => {
    const entry = byName.get(name)
    const kills = entry?.score ?? null
    return {
      name,
      kills,
      rank: entry?.rank ?? null,
      ranked: kills !== null,
    }
  })
}

/**
 * Most-killed first, unranked last, alphabetical within a tie.
 *
 * Unranked rows sort to the bottom rather than to zero: they are unknown, not
 * empty, and a "boss I have never touched" and a "boss below the rank cutoff"
 * both belong out of the way of the list's actual answer.
 */
export function sortByKills(rows: readonly BossRow[]): BossRow[] {
  return [...rows].sort((a, b) => {
    if (a.ranked !== b.ranked) return a.ranked ? -1 : 1
    if (a.kills !== b.kills) return (b.kills ?? 0) - (a.kills ?? 0)
    return a.name.localeCompare(b.name)
  })
}

/**
 * Activity names the response carried that neither list knows about.
 *
 * This is the drift report, and it is the reason the non-boss names are
 * enumerated above. A new boss is added to the hiscores the day it releases;
 * without this it would be invisible to us forever, because a list built by
 * hand has no other way to learn that it is out of date. Same role as the
 * diary store's `syncUnknownTierIds`: surface the disagreement rather than
 * absorb it.
 *
 * Expect this to be empty. When it isn't, add the name to `BOSS_NAMES` or
 * `OTHER_ACTIVITY_NAMES` — a judgement about which, not a mechanical fix.
 */
export function unclassifiedActivities(
  activities: readonly ActivityEntry[],
): string[] {
  return activities
    .map((entry) => entry.name)
    .filter((name) => classifyActivity(name) === 'unknown')
}

/** Headline counts for the panel's summary line. */
export interface BossTotals {
  /** Bosses with a published count above zero. */
  killed: number
  /** Bosses in the list, published or not. */
  total: number
  /** Sum of every published kill count. */
  kills: number
}

export function bossTotals(rows: readonly BossRow[]): BossTotals {
  let killed = 0
  let kills = 0
  for (const row of rows) {
    if (row.kills && row.kills > 0) killed++
    kills += row.kills ?? 0
  }
  return { killed, total: rows.length, kills }
}
