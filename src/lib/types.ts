/**
 * Single source of truth for shapes crossing the client ↔ Function boundary.
 *
 * This module is pure: no DOM, no network, no imports. The Pages Functions
 * import it by relative path across the `functions/` ↔ `src/` boundary, so
 * keep it that way.
 */

/**
 * The 23 skills in OSRS hiscore column order. The hiscores response leads with
 * an "Overall" row before these, which is handled separately — Overall is a
 * derived total, not a skill, and treating it as one leaks into every UI that
 * iterates skills.
 */
export const SKILL_NAMES = [
  'Attack',
  'Defence',
  'Strength',
  'Hitpoints',
  'Ranged',
  'Prayer',
  'Magic',
  'Cooking',
  'Woodcutting',
  'Fletching',
  'Fishing',
  'Firemaking',
  'Crafting',
  'Smithing',
  'Mining',
  'Herblore',
  'Agility',
  'Thieving',
  'Slayer',
  'Farming',
  'Runecraft',
  'Hunter',
  'Construction',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]

/** Account types map to separate hiscore tables; the Function owns the URLs. */
export type AccountType =
  | 'normal'
  | 'ironman'
  | 'hardcore'
  | 'ultimate'
  | 'deadman'
  | 'seasonal'
  | 'tournament'
  | 'skiller'
  | 'skiller_defence'

export interface SkillEntry {
  name: SkillName
  /** Hiscore position, or null when the player is unranked in this skill. */
  rank: number | null
  level: number
  xp: number
}

export interface ActivityEntry {
  name: string
  rank: number | null
  /** Kill count, completions, or points depending on the activity. */
  score: number | null
}

export interface HiscoresSnapshot {
  username: string
  accountType: AccountType
  /** Epoch ms the data was fetched. Drives the "as of" label when offline. */
  fetchedAt: number
  overall: { rank: number | null; level: number; xp: number }
  skills: SkillEntry[]
  activities: ActivityEntry[]
}

export type HiscoresError =
  'not_found' | 'invalid_username' | 'upstream_error' | 'timeout' | 'too_large'

/** Discriminated result so callers must handle failure explicitly. */
export type HiscoresResult =
  | { ok: true; snapshot: HiscoresSnapshot }
  | { ok: false; error: HiscoresError; message: string }

/* ------------------------------------------------------------------ quests */

export type QuestDifficulty =
  | 'Novice'
  | 'Intermediate'
  | 'Experienced'
  | 'Master'
  | 'Grandmaster'
  | 'Special'

export interface SkillRequirement {
  skill: SkillName
  level: number
  /** Whether a boost can substitute — changes "blocked" to "reachable". */
  boostable?: boolean
}

export interface QuestRequirements {
  skills: SkillRequirement[]
  /** Prerequisite quest ids. Must resolve within the dataset. */
  quests: string[]
  questPoints?: number
  combatLevel?: number
}

export interface Quest {
  /** Slug, e.g. "cooks-assistant". Stable across dataset regenerations. */
  id: string
  name: string
  difficulty: QuestDifficulty
  questPoints: number
  members: boolean
  miniquest: boolean
  requirements: QuestRequirements
  wikiUrl: string
}

/** Generated artifact shape for src/data/quests.json. */
export interface QuestDataset {
  /** ISO date the dataset was generated, shown in settings. */
  generatedAt: string
  source: string
  quests: Quest[]
}
