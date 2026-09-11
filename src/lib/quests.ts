/**
 * Quest eligibility and plan ordering.
 *
 * Pure: no DOM, no network, no imports beyond types — it lives in `src/lib`
 * and is compiled by both tsconfig projects, so it must stay that way.
 *
 * The two inputs come from opposite worlds and must not be conflated. Skill
 * levels are **fetched and read-only**; quest progress is **hand-entered,
 * authoritative and unrecoverable**. This module only reads them.
 *
 * Everything here is deliberately conservative in one direction: when the data
 * doesn't say, it must not claim a quest is out of reach. A wrong "you can
 * start this" is visible and self-correcting — you open the quest and find out.
 * A wrong "blocked" hides a quest you could have done, and you never learn it
 * was hidden.
 */
import { SKILL_NAMES } from './types'
import type { Quest, QuestPrerequisite, SkillName } from './types'

/**
 * The three states the in-game quest journal itself uses, which is why the
 * design tokens are `todo` / `doing` / `done`. "doing" is not decoration: 14
 * prerequisites need the earlier quest only *started*, and without a distinct
 * in-progress state those can't be satisfied without lying in one direction or
 * the other.
 */
export type QuestProgress = 'todo' | 'doing' | 'done'

/** Levels by skill, from a hiscores snapshot. Absent means unknown, not zero. */
export type SkillLevels = Partial<Record<SkillName, number>>

/** Quest id -> progress. Anything absent is `todo`. */
export type ProgressMap = Readonly<Record<string, QuestProgress>>

export interface PlayerState {
  levels: SkillLevels
  progress: ProgressMap
}

export interface UnmetSkill {
  skill: SkillName
  need: number
  /** The player's level, or `null` when we have no snapshot for it. */
  have: number | null
  /** A boost may substitute; the UI should say so rather than say "blocked". */
  boostable: boolean | null
  /**
   * `true` blocks starting, `false` is needed only to finish, `null` means the
   * wiki doesn't say. Unknown is treated as "not blocking" so the quest still
   * surfaces — see the conservatism note at the top.
   */
  requiredToStart: boolean | null
}

export interface UnmetPrerequisite extends QuestPrerequisite {
  /**
   * True when the requirement is only that the quest be *started* and we have
   * no record either way. The player may well have started it, so this is a
   * caveat to show, not a reason to call the quest blocked.
   */
  uncertain: boolean
}

export interface QuestStatus {
  id: string
  progress: QuestProgress
  /** Nothing unmet that the wiki says prevents starting. */
  canStart: boolean
  /** Nothing unmet at all: startable and finishable as things stand. */
  canFinish: boolean
  unmetSkills: UnmetSkill[]
  unmetQuests: UnmetPrerequisite[]
  unmetQuestPoints: { need: number; have: number } | null
  unmetCombatLevel: { need: number; have: number } | null
  /**
   * Requirements no program can check, carried straight from the dataset.
   * A quest with `canStart: true` and notes is not a promise — it's "your
   * levels and history clear it, and the wiki also wants these things".
   */
  notes: string[]
}

/** Indexed dataset. Build once; every function here takes it. */
export interface QuestIndex {
  byId: ReadonlyMap<string, Quest>
  all: readonly Quest[]
}

export function buildIndex(quests: readonly Quest[]): QuestIndex {
  return { byId: new Map(quests.map((q) => [q.id, q])), all: quests }
}

export function progressOf(id: string, progress: ProgressMap): QuestProgress {
  return progress[id] ?? 'todo'
}

/**
 * Jagex's published combat level formula. Needed because one quest — Dream
 * Mentor — states a combat requirement, and without this it can't be checked
 * at all. Returns `null` if any contributing level is missing, rather than
 * computing a low level from absent data and calling quests blocked.
 */
export function combatLevel(levels: SkillLevels): number | null {
  const need: SkillName[] = [
    'Attack',
    'Strength',
    'Defence',
    'Hitpoints',
    'Ranged',
    'Prayer',
    'Magic',
  ]
  if (need.some((skill) => levels[skill] === undefined)) return null

  const at = levels.Attack!
  const st = levels.Strength!
  const def = levels.Defence!
  const hp = levels.Hitpoints!
  const ranged = levels.Ranged!
  const prayer = levels.Prayer!
  const magic = levels.Magic!

  const base = 0.25 * (def + hp + Math.floor(prayer / 2))
  const melee = 0.325 * (at + st)
  const range = 0.325 * Math.floor((3 * ranged) / 2)
  const mage = 0.325 * Math.floor((3 * magic) / 2)
  return Math.floor(base + Math.max(melee, range, mage))
}

/** Quest points earned, summed from what the player has actually completed. */
export function questPointsEarned(
  index: QuestIndex,
  progress: ProgressMap,
): number {
  let total = 0
  for (const quest of index.all) {
    if (progressOf(quest.id, progress) === 'done') total += quest.questPoints
  }
  return total
}

/** Whether a prerequisite is satisfied by the player's recorded progress. */
function prerequisiteMet(
  prereq: QuestPrerequisite,
  progress: ProgressMap,
): boolean {
  const state = progressOf(prereq.id, progress)
  if (state === 'done') return true
  // "Started" is satisfied by an in-progress quest, which is the whole reason
  // progress has three states rather than a boolean.
  return prereq.completion === 'started' && state === 'doing'
}

/**
 * Evaluates one quest against the player's levels and history.
 *
 * A missing skill level (no hiscores snapshot yet, or an unranked skill) is
 * reported as `have: null` and counted as unmet — but the UI must render that
 * as "unknown" rather than "too low", because the two mean different things
 * and only one is the player's problem.
 */
export function evaluateQuest(
  quest: Quest,
  state: PlayerState,
  index: QuestIndex,
): QuestStatus {
  const unmetSkills: UnmetSkill[] = []
  for (const requirement of quest.requirements.skills) {
    const have = state.levels[requirement.skill] ?? null
    if (have !== null && have >= requirement.level) continue
    unmetSkills.push({
      skill: requirement.skill,
      need: requirement.level,
      have,
      boostable: requirement.boostable,
      requiredToStart: requirement.requiredToStart,
    })
  }

  const unmetQuests: UnmetPrerequisite[] = []
  for (const prereq of quest.requirements.quests) {
    if (prerequisiteMet(prereq, state.progress)) continue
    unmetQuests.push({
      ...prereq,
      uncertain:
        prereq.completion === 'started' &&
        progressOf(prereq.id, state.progress) === 'todo',
    })
  }

  /*
   * Only totalled when a quest actually gates on quest points, which 13 of
   * 214 do. Computing it unconditionally made evaluating the whole dataset
   * O(n²) — ~46k iterations, re-run on every progress change, on a tablet.
   */
  const needPoints = quest.requirements.questPoints
  const havePoints =
    needPoints === undefined ? 0 : questPointsEarned(index, state.progress)
  const unmetQuestPoints =
    needPoints !== undefined && havePoints < needPoints
      ? { need: needPoints, have: havePoints }
      : null

  const needCombat = quest.requirements.combatLevel
  const haveCombat = combatLevel(state.levels)
  const unmetCombatLevel =
    needCombat !== undefined && haveCombat !== null && haveCombat < needCombat
      ? { need: needCombat, have: haveCombat }
      : null

  // Only requirements the wiki explicitly marks as needed to start can block
  // starting. Unknown and finish-only requirements are surfaced, not gates —
  // see ROADMAP.md, "requiredToStart annotates; it does not gate".
  const skillsBlockingStart = unmetSkills.some(
    (s) => s.requiredToStart === true,
  )
  const questsBlockingStart = unmetQuests.some((q) => !q.uncertain)

  const canFinish =
    !unmetSkills.length &&
    !unmetQuests.length &&
    !unmetQuestPoints &&
    !unmetCombatLevel

  return {
    id: quest.id,
    progress: progressOf(quest.id, state.progress),
    canStart:
      !skillsBlockingStart &&
      !questsBlockingStart &&
      !unmetQuestPoints &&
      !unmetCombatLevel,
    canFinish,
    unmetSkills,
    unmetQuests,
    unmetQuestPoints,
    unmetCombatLevel,
    notes: quest.notes,
  }
}

export interface PlanStep {
  quest: Quest
  status: QuestStatus
  /**
   * True when the player asked for this quest, false when it's here only
   * because something they asked for needs it. Worth showing: "I never picked
   * this" is a reasonable question about a 20-step plan.
   */
  goal: boolean
}

/**
 * Expands chosen goals into an ordered plan: every unfinished prerequisite,
 * deepest first, then the goals themselves.
 *
 * The queue is curated, not automatic — you pick what you want and this works
 * backwards. That's why it takes goal ids rather than deriving a list from all
 * 214 quests, which would be a firehose rather than a plan.
 *
 * Order is a depth-first post-order over sorted prerequisites, so it is stable
 * across runs: the same goals always produce the same plan, which matters when
 * the plan is persisted and returned to between sessions.
 */
export function buildPlan(
  goalIds: readonly string[],
  state: PlayerState,
  index: QuestIndex,
): PlanStep[] {
  const goals = new Set(goalIds)
  const steps: PlanStep[] = []
  const placed = new Set<string>()
  const visiting = new Set<string>()

  const visit = (id: string) => {
    if (placed.has(id)) return
    // The dataset is validated acyclic at generation time, so this guard is
    // for a hand-edited file rather than the wiki.
    if (visiting.has(id)) return
    const quest = index.byId.get(id)
    if (!quest) return

    visiting.add(id)
    const prereqs = [...quest.requirements.quests].sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    for (const prereq of prereqs) {
      if (!prerequisiteMet(prereq, state.progress)) visit(prereq.id)
    }
    visiting.delete(id)

    if (placed.has(id)) return
    placed.add(id)

    // Finished quests are prerequisites already satisfied; they don't belong
    // in a list of things to do.
    if (progressOf(id, state.progress) === 'done') return
    steps.push({
      quest,
      status: evaluateQuest(quest, state, index),
      goal: goals.has(id),
    })
  }

  for (const id of [...goals].sort()) visit(id)
  return steps
}

/**
 * Every quest the player could start right now, for the browse panel's
 * headline filter. Excludes what they've finished; includes what they've
 * started, since "keep going" is also an answer to "what now".
 */
export function startableNow(
  state: PlayerState,
  index: QuestIndex,
): QuestStatus[] {
  return index.all
    .map((quest) => evaluateQuest(quest, state, index))
    .filter((status) => status.progress !== 'done' && status.canStart)
}

/**
 * A skill or combat level named at the *start* of an item line, e.g.
 * "Combat 95" or "Prayer 43 for overhead protection Prayers".
 *
 * `met` is `null` when the level isn't known — the same third state the rest of
 * this module keeps, and the reason the UI must not paint an uncoloured line as
 * "too low".
 */
export interface MentionedLevel {
  /** `null` for combat, which is a derived level rather than a skill. */
  skill: SkillName | null
  need: number
  have: number | null
  met: boolean | null
}

/**
 * Finds a level requirement stated at the start of an item line, or `null`.
 *
 * **Anchored deliberately.** Scanning anywhere in the line matches the numbers
 * that belong to items rather than levels — "1-2 prayer potions", "12 Magic
 * logs (can be noted)", "3-100 magic logs" — and every one of those would be
 * painted as a level the player has or lacks. Measured against the dataset, the
 * anchor drops all 48 such false positives and still reaches 203 lines, of
 * which 139 are combat.
 *
 * Item lines are prose, so this is presentation sugar, not a requirement the
 * engine gates on. `evaluateQuest` neither calls it nor knows it exists.
 */
export function mentionedLevel(
  text: string,
  levels: SkillLevels,
): MentionedLevel | null {
  const match = LEVEL_AT_START.exec(text.trim())
  if (!match) return null

  const name = match[1]
  const need = Number(match[2])
  if (!Number.isFinite(need)) return null

  if (/^combat$/i.test(name)) {
    const have = combatLevel(levels)
    return { skill: null, need, have, met: have === null ? null : have >= need }
  }

  // Match is case-insensitive, so recover the canonical casing for lookup.
  const skill = SKILL_NAMES.find((s) => s.toLowerCase() === name.toLowerCase())
  if (!skill) return null

  const have = levels[skill] ?? null
  return { skill, need, have, met: have === null ? null : have >= need }
}

// String.raw, not a plain template literal: `\s` and `\d` in an interpolated
// template are read as the characters "s" and "d", which silently yields a
// regex that matches nothing rather than one that fails to compile.
const LEVEL_AT_START = new RegExp(
  String.raw`^(${[...SKILL_NAMES, 'Combat'].join('|')})\s+(\d{1,3})\b`,
  'i',
)
