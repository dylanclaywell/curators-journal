/**
 * Hiscores parsing and the level arithmetic that goes with it.
 *
 * Pure: no DOM, no network, no imports beyond types. The Worker parses upstream
 * responses with this and the client re-derives display values from the same
 * code, so there is exactly one definition of "what level is this XP".
 */
import {
  SKILL_NAMES,
  type AccountType,
  type ActivityEntry,
  type HiscoresResult,
  type HiscoresSnapshot,
  type SkillEntry,
  type SkillName,
} from './types'

/**
 * Shape of index_lite.json, as verified against the live endpoint.
 *
 * `skills` leads with an Overall row (id 0) then one row per skill. Unranked
 * entries encode differently between the two arrays, which is the whole reason
 * this parser exists rather than a cast:
 *
 *   skill    { rank: -1, level: 1, xp: 0 }   — only rank is absent
 *   activity { rank: -1, score: -1 }         — both are absent
 */
interface RawRow {
  id?: number
  name?: string
  rank?: number
  level?: number
  xp?: number
  score?: number
}

interface RawHiscores {
  name?: string
  skills?: RawRow[]
  activities?: RawRow[]
}

/** Jagex uses -1 for "not on the board", which is not the same as zero. */
function nullIfUnranked(value: unknown): number | null {
  return typeof value === 'number' && value >= 0 ? value : null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Only long enough to stop absurd input costing an upstream request. Real
 * display names are shorter, but the exact limit isn't worth asserting.
 */
const MAX_USERNAME_LENGTH = 20

/**
 * Checked by code point rather than a regex character class — a control-char
 * range written as a literal in source is a portability hazard, and this reads
 * more plainly anyway.
 *
 * Belt and braces, not load-bearing: Cloudflare's edge already rewrites
 * percent-encoded control characters in a query string to spaces before the
 * Worker runs (verified — `?player=zz%0Azz` arrives as "zz zz"), so this only
 * fires for input reaching the function by some other route.
 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function normalizeUsername(input: string): string {
  // Underscores and spaces are interchangeable upstream — verified: a request
  // for "Lynx_Titan" returns Lynx Titan's data. Collapsing runs of either
  // means the two spellings share one cache entry.
  return input.trim().replace(/[\s_]+/g, ' ')
}

/**
 * Deliberately permissive.
 *
 * Real display names contain characters an allowlist won't predict — pipes, for
 * one — and the hiscores answer an unrecognised name with the same 404 either
 * way. So there is nothing to gain by guessing at the character set, and a real
 * player to lock out by guessing wrong.
 *
 * This is **not** the URL guard: `encodeURIComponent` at the call site is. All
 * this rejects is what cannot be a name at all.
 */
export function isValidUsername(input: string): boolean {
  // Control characters are checked on the trimmed input, *before* normalizing.
  // Normalizing collapses all whitespace — newlines and tabs included — so
  // checking afterwards would silently reinterpret a pasted multi-line string
  // as a plausible name rather than rejecting it.
  const trimmed = input.trim()
  if (hasControlChars(trimmed)) return false

  const name = normalizeUsername(input)
  return name.length > 0 && name.length <= MAX_USERNAME_LENGTH
}

/**
 * Total XP required to reach `level`, by the standard RuneScape formula.
 * Level 99 is 13,034,431 — a useful spot-check if this is ever touched.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  let total = 0
  for (let n = 1; n < level; n++) {
    total += Math.floor(n + 300 * Math.pow(2, n / 7))
  }
  return Math.floor(total / 4)
}

/** Precomputed through 126 so virtual levels above 99 resolve too. */
const XP_TABLE: number[] = Array.from({ length: 127 }, (_, level) =>
  xpForLevel(level),
)

export const MAX_LEVEL = 99

/** The level a given XP total earns, including virtual levels past 99. */
export function levelForXp(xp: number): number {
  let level = 1
  while (level < 126 && XP_TABLE[level + 1] <= xp) level++
  return level
}

/**
 * XP still needed for the next level, and how far through the current one you
 * are. Returns null at the top of the table, where "next" is meaningless.
 */
export function xpToNextLevel(
  xp: number,
): { remaining: number; progress: number } | null {
  const level = levelForXp(xp)
  if (level >= 126) return null

  const start = XP_TABLE[level]
  const next = XP_TABLE[level + 1]
  const span = next - start
  return {
    remaining: next - xp,
    // Guard the division: consecutive table entries are never equal, but a
    // caller passing a doctored snapshot shouldn't produce NaN in the UI.
    progress: span > 0 ? (xp - start) / span : 0,
  }
}

/**
 * OSRS combat level. Ranged and Magic count their own level one and a half
 * times, which is why they floor before scaling rather than after.
 *
 * All-99 (no Sailing contribution) gives 126, matching the in-game cap.
 */
export function combatLevel(
  levels: Partial<Record<SkillName, number>>,
): number {
  const lvl = (name: SkillName) => levels[name] ?? 1

  const base =
    0.25 * (lvl('Defence') + lvl('Hitpoints') + Math.floor(lvl('Prayer') / 2))
  const melee = 0.325 * (lvl('Attack') + lvl('Strength'))
  const ranged = 0.325 * Math.floor((lvl('Ranged') * 3) / 2)
  const magic = 0.325 * Math.floor((lvl('Magic') * 3) / 2)

  return Math.floor(base + Math.max(melee, ranged, magic))
}

/** Convenience for callers holding a parsed snapshot. */
export function combatLevelOf(snapshot: HiscoresSnapshot): number {
  const levels: Partial<Record<SkillName, number>> = {}
  for (const skill of snapshot.skills) levels[skill.name] = skill.level
  return combatLevel(levels)
}

/**
 * Turns a raw index_lite.json body into a snapshot, or an error result.
 *
 * Skills are matched **by name**, not by array position: Sailing was appended
 * to this response at id 24, and the next addition may not be at the end.
 * A skill we know about but the response omits comes back as level 1 / unranked
 * so the UI grid keeps a stable shape.
 */
export function parseHiscores(
  raw: unknown,
  username: string,
  accountType: AccountType,
  fetchedAt: number,
): HiscoresResult {
  const body = raw as RawHiscores

  if (!body || !Array.isArray(body.skills) || body.skills.length === 0) {
    return {
      ok: false,
      error: 'upstream_error',
      message: 'Hiscores response had no skills.',
    }
  }

  const byName = new Map<string, RawRow>()
  for (const row of body.skills) {
    if (typeof row?.name === 'string') byName.set(row.name, row)
  }

  const overallRow = byName.get('Overall') ?? body.skills[0]

  const skills: SkillEntry[] = SKILL_NAMES.map((name) => {
    const row = byName.get(name)
    return {
      name,
      rank: nullIfUnranked(row?.rank),
      level: numberOr(row?.level, 1),
      xp: numberOr(row?.xp, 0),
    }
  })

  const activities: ActivityEntry[] = Array.isArray(body.activities)
    ? body.activities
        .filter((row): row is RawRow => typeof row?.name === 'string')
        .map((row) => ({
          name: (row.name ?? '').trim(),
          rank: nullIfUnranked(row.rank),
          score: nullIfUnranked(row.score),
        }))
    : []

  return {
    ok: true,
    snapshot: {
      username,
      displayName:
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : username,
      accountType,
      fetchedAt,
      overall: {
        rank: nullIfUnranked(overallRow?.rank),
        level: numberOr(overallRow?.level, 0),
        xp: numberOr(overallRow?.xp, 0),
      },
      skills,
      activities,
    },
  }
}
