/**
 * Single source of truth for shapes crossing the client ↔ Worker boundary.
 *
 * This module is pure: no DOM, no network, no imports. `src/worker/` imports it
 * by relative path across the `src/worker/` ↔ `src/` boundary and type-checks
 * separately against `tsconfig.worker.json`, so keep it that way.
 */

/**
 * The 24 skills in OSRS hiscore column order, verified against a live
 * index_lite.json response. The response leads with an "Overall" row before
 * these, which is handled separately — Overall is a derived total, not a skill,
 * and treating it as one leaks into every UI that iterates skills.
 *
 * Order is the response's own id order, but the parser matches by name rather
 * than position so a skill inserted mid-list can't silently shift everything.
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
  'Sailing',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]

/** Account types map to separate hiscore tables; the Worker owns the URLs. */
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
  /** What we asked for, normalized. Use this as a lookup/persistence key. */
  username: string
  /**
   * Canonical capitalization as Jagex spells it, from the response's own `name`
   * field. Display this rather than whatever the user typed.
   */
  displayName: string
  accountType: AccountType
  /** Epoch ms the data was fetched. Drives the "as of" label when offline. */
  fetchedAt: number
  overall: { rank: number | null; level: number; xp: number }
  skills: SkillEntry[]
  activities: ActivityEntry[]
}

export type HiscoresError =
  | 'not_found'
  | 'invalid_username'
  | 'upstream_error'
  | 'timeout'
  | 'too_large'
  /** Client-only: the request never left the device. The Worker never sends this. */
  | 'offline'

/** Discriminated result so callers must handle failure explicitly. */
export type HiscoresResult =
  | { ok: true; snapshot: HiscoresSnapshot }
  | { ok: false; error: HiscoresError; message: string }

/* ------------------------------------------------------------------ quests */

/**
 * "Special" is real, not a fallback: every Recipe for Disaster page uses it.
 * The union stays closed to the six values the wiki's own template documents,
 * so a page carrying anything else is reported as a defect, not absorbed.
 */
export type QuestDifficulty =
  | 'Novice'
  | 'Intermediate'
  | 'Experienced'
  | 'Master'
  | 'Grandmaster'
  | 'Special'

/** The wiki's own length buckets. Display only; nothing computes on it. */
export type QuestLength =
  'Very Short' | 'Short' | 'Medium' | 'Long' | 'Very Long'

/**
 * `null` means the wiki doesn't say, which is common enough to matter: of 415
 * skill-requirement lines, 31 don't state boostability and 93 don't state
 * whether the requirement blocks starting. Defaulting either to `false` would
 * assert something the source never claimed, so unknown gets its own value and
 * the UI has to render it as unknown.
 */
export interface SkillRequirement {
  skill: SkillName
  level: number
  /** Whether a boost can substitute — changes "blocked" to "reachable". */
  boostable: boolean | null
  /**
   * Whether this blocks *starting* the quest, as opposed to finishing it.
   * Annotating rather than gating is the current decision: a quest you can
   * start but not finish still shows as available, with this marked. See
   * ROADMAP.md — provisional until the queue is used on the device.
   */
  requiredToStart: boolean | null
}

/**
 * Prerequisite quests are usually "finished", but a handful only need to be
 * *started* — 14 such cases exist. Collapsing them to "finished" would report a
 * startable quest as blocked, so the distinction is carried explicitly.
 */
export interface QuestPrerequisite {
  /** A `Quest.id` in this dataset. Generation fails if it doesn't resolve. */
  id: string
  completion: 'finished' | 'started'
}

/**
 * Only quest points and combat level are templated on quest pages, so only
 * they can be checked. The other non-skill requirements the wiki records —
 * Varrock Museum kudos for Bone Voyage, Barbarian Assault role levels — appear
 * as prose and land in `Quest.notes`, displayed rather than computed. No field
 * here that the generator cannot populate.
 */
export interface QuestRequirements {
  skills: SkillRequirement[]
  quests: QuestPrerequisite[]
  /** Total quest points. 13 quests gate on this, up to 200 for Dragon Slayer II. */
  questPoints?: number
  combatLevel?: number
}

export interface Quest {
  /** Slug, e.g. "cooks-assistant". Stable across dataset regenerations. */
  id: string
  name: string
  /**
   * `null` when the page does not state a valid one. Three miniquest pages
   * carry a number instead of a word, which the template forbids; the
   * generator reports them rather than guessing a mapping.
   */
  difficulty: QuestDifficulty | null
  length: QuestLength | null
  /** Quest points awarded. 0 for miniquests, which award none. */
  questPoints: number
  members: boolean
  miniquest: boolean
  /**
   * Display grouping, from the wiki's `series` field or an enclosing multi-part
   * quest — "Recipe for Disaster" for its ten subquests, which are separate
   * entries because other quests depend on them individually.
   *
   * Display only. A series is never a dependency; the graph lives in
   * `requirements.quests`.
   */
  group: string | null
  requirements: QuestRequirements
  /**
   * Requirements no program can check: "the ability to defeat a level 83
   * dragon", "Access to Mort'ton". ~96 exist, so **eligibility is never fully
   * computable from levels** — these must reach the player, or the app will
   * call a quest startable when it isn't.
   */
  notes: string[]
  wikiUrl: string
}

/** Generated artifact shape for src/data/quests.json. */
export interface QuestDataset {
  /** ISO date the dataset was generated, shown in settings. */
  generatedAt: string
  /** Wiki pages are the source; `Module:Questreq/data` is the cross-check. */
  sources: string[]
  quests: Quest[]
}
