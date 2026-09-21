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

/**
 * One line of a quest's item list. Display only — nothing computes on these,
 * because there is no inventory to check them against.
 *
 * A flat list of strings would have been enough for the ~200 quests whose items
 * are a plain list, but not for the ones that branch: Heroes' Quest lists its
 * items under "If you are a Black Arm Gang member:" and "If you are a Phoenix
 * Gang member:", and flattening those tells the player to bring both sets. That
 * is the same invisible wrongness that ruled out Wise Old Man and the composite
 * Recipe for Disaster entry, so the structure is carried instead of discarded.
 */
export interface QuestItemLine {
  /** Plain text, wiki markup already stripped. */
  text: string
  /**
   * A label introducing the lines beneath it, rather than an item itself.
   * Detected by a trailing colon, which is how the wiki writes them — 15 of the
   * 16 real headings in the dataset. The exception is a bare "Recommended" on
   * Forgettable Tale, which renders as an ordinary line; a wholly-bold rule
   * would catch it but would also promote The Tourist Trap's bolded *note* to a
   * heading, so the quieter failure was chosen.
   */
  heading?: boolean
  /**
   * Nesting depth in the wiki's bullet list; omitted at top level. Kept rather
   * than flattened because a sub-bullet is usually a detail hanging off the line
   * above ("Additional antipoison when fighting the hespori") and reads as a
   * separate requirement once promoted. Goes 4 deep on 90 pages.
   */
  depth?: number
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
  /**
   * The wiki's `description` field, one entry per paragraph (it's usually one,
   * occasionally two or three). Flavor text, not a requirement — shown so a
   * quick "what is this quest actually about" doesn't need a wiki tab.
   */
  description: string[]
  /** The wiki's `start` field: where and who to talk to. Empty when unstated. */
  startPoint: string
  /**
   * The wiki's `kills` field: monsters the quest requires fighting, same
   * bulleted shape as `itemsRequired`. Not part of `QuestRequirements` for the
   * same reason items aren't — the engine never gates on this.
   */
  kills: QuestItemLine[]
  /**
   * The `Quest rewards` template's `rewards` field: XP, unlocks and items
   * granted on completion, beyond the `questPoints` already broken out.
   * Same bulleted shape as `itemsRequired` since the wiki writes it the same way.
   */
  rewards: QuestItemLine[]
  /**
   * Items the wiki says to bring. Deliberately *not* in `QuestRequirements`:
   * the engine never reads these, so they don't belong beside the fields
   * `canStart` / `canFinish` gate on.
   *
   * Near-universal — 200 of 216 pages state some — so an empty array usually
   * means the quest genuinely needs nothing, not that the data is missing.
   */
  itemsRequired: QuestItemLine[]
  /**
   * The wiki's `recommended` param. Kept separate from `itemsRequired` rather
   * than merged: required vs. recommended is a distinction this dataset already
   * carries elsewhere (see `SkillRequirement.requiredToStart`), and collapsing
   * it here would be the same mistake in miniature.
   *
   * Not strictly items — it also carries travel routes, combat levels and
   * inventory-space advice — so present it as "recommended", not as a second
   * item list.
   */
  itemsRecommended: QuestItemLine[]
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

/* ----------------------------------------------------------------- diaries */

/**
 * The four tiers, in the order the wiki lists them and the order their rewards
 * unlock. Closed: all 12 diary pages carry exactly these four, verified against
 * the live wiki, so a page yielding anything else is a defect to report rather
 * than a value to absorb.
 */
export const DIARY_TIERS = ['Easy', 'Medium', 'Hard', 'Elite'] as const

export type DiaryTierName = (typeof DIARY_TIERS)[number]

/**
 * One numbered task within a tier.
 *
 * Tasks carry parsed requirements rather than prose, which is the one place
 * this dataset goes further than quests do. The wiki writes each task's
 * requirement cell as `{{SCP|Thieving|38}}` and `{{SCP|Quest}} Started [[Sea
 * Slug]]` templates, so they reduce to the same shapes quest requirements use
 * — and reducing them is what lets the UI say *which* task is blocking a tier
 * instead of only that the tier is blocked.
 */
export interface DiaryTask {
  /**
   * Content-derived and stable across regeneration: `<tierId>-<8 hex>`, from
   * `taskIdFor` in `task-id.ts`. Completions are keyed on this; see that
   * module for the scheme and why it is content-derived rather than positional.
   */
  id: string
  /** The task text, wiki markup stripped. Numbering is positional, not stored. */
  text: string
  /**
   * Requirements parsed from the task's own cell. `questPoints` and
   * `combatLevel` appear here as they do on quests: nine tasks state a combat
   * level via `{{SCP|Combat|N}}`.
   */
  requirements: QuestRequirements
  /**
   * Items and access the task needs, as bulleted lines. Display only, exactly
   * as `Quest.itemsRequired` is — there is still no inventory to check against.
   */
  items: QuestItemLine[]
  /**
   * Requirements that did not reduce to structured data: footnotes, ironman
   * caveats, and prose like "Partial completion of Watchtower" that names no
   * quest we can resolve. Same contract as `Quest.notes` — shown, never gated
   * on.
   */
  notes: string[]
}

/**
 * One tier of one diary: the unit progress is tracked against.
 *
 * A tier is structurally a quest — skill levels, prerequisite quests, quest
 * points — which is why `evaluateRequirements` serves both and the engine
 * needed almost nothing new. What it is *not* is a quest prerequisite: nothing
 * in the quest graph depends on a diary, so diaries never enter `buildPlan`'s
 * ordering.
 */
export interface DiaryTier {
  /** Slug, e.g. "ardougne-hard". Stable: completions reference it. */
  id: string
  tier: DiaryTierName
  /**
   * The tier's own stated requirements, from `{{DiarySkillStats}}` and the
   * quest table beside it. The generator cross-checks these against the union
   * of `tasks` and reports disagreement — the wiki maintains the two by hand
   * and they drift.
   */
  requirements: QuestRequirements
  tasks: DiaryTask[]
  /** Unstructured requirements stated for the tier as a whole. */
  notes: string[]
  /** What completing the tier grants, same bulleted shape as `Quest.rewards`. */
  rewards: QuestItemLine[]
}

/**
 * One of the 12 achievement diaries.
 *
 * Tiers are independent for *completion* — tasks may be done in any order — but
 * sequential for *rewards*: the wiki is explicit that earlier tiers must be
 * finished before a later tier's rewards can be claimed. So the engine must not
 * treat Easy as a prerequisite of Medium; only the reward is gated, and that
 * distinction belongs in the UI rather than in eligibility.
 */
export interface Diary {
  /** Slug, e.g. "ardougne". Stable: tier ids are derived from it. */
  id: string
  name: string
  /** The areas the tasks cover, from the infobox. Display only. */
  areas: string[]
  members: boolean
  /** Where the rewards are claimed, from the infobox's `taskmasters`. */
  taskmaster: string
  tiers: DiaryTier[]
  wikiUrl: string
}

/** Generated artifact shape for src/data/diaries.json. */
export interface DiaryDataset {
  /** ISO date the dataset was generated, shown in settings. */
  generatedAt: string
  sources: string[]
  diaries: Diary[]
}

/* ------------------------------------------------------------------ bosses */

/**
 * One statistical version of a boss.
 *
 * Bosses are versioned far more often than quests or diaries are: Vorkath has
 * a pre- and post-Dragon Slayer II form plus an Awakened variant, and the wiki
 * encodes that as parallel `combat1`/`combat2` parameters inside one
 * `{{Infobox Monster}}`. Flattening those to "the" combat level would state a
 * number the wiki never states, and picking version 1 silently is worse — it
 * looks right. So every version is carried and the UI names which one it is
 * showing.
 */
export interface BossVersion {
  /** The wiki's own label, e.g. "Post-quest". Null when there is only one. */
  label: string | null
  combatLevel: number | null
  hitpoints: number | null
  /**
   * Free text, not a number: the wiki writes "30 (Magic), 32 (Ranged), 80
   * (Dragonfire)" and the breakdown is the useful part.
   */
  maxHit: string | null
  attackStyles: string[]
  attackSpeed: number | null
  slayerLevel: number | null
  slayerXp: number | null
}

/**
 * A boss, from the wiki — whether or not the hiscores count it.
 *
 * The wiki is the spine here, which is the opposite of how quests and diaries
 * work and deliberately so. The hiscores publish kill counts for 71 bosses;
 * the wiki documents ~173. The extra ~100 (raid rooms like Akkha, quest bosses
 * like Agrith Naar) have drops and requirements worth reading and no kill
 * count that exists anywhere — not in a third-party API, not in the game. So
 * `hiscoreName` is nullable, and a null means "no count is published for this
 * boss", which the UI must not render as zero.
 */
export interface Boss {
  /** Slug of the wiki title, or of the hiscore name for a variant. */
  id: string
  name: string
  /** Canonical wiki page title. Several bosses may share one. */
  page: string
  wikiUrl: string
  members: boolean
  /**
   * The hiscores' own spelling, when they publish a count for this boss. This
   * is the join key for kill counts — never an id, since the hiscores'
   * activity block is alphabetical and renumbers on every release.
   */
  hiscoreName: string | null
  /**
   * Set when this entry is a harder mode of another that shares its page —
   * Tombs of Amascut: Expert Mode, The Corrupted Gauntlet. They have their own
   * kill counts but no page of their own, so they are separate entries
   * pointing at the same prose rather than one entry with two counts.
   */
  variantOf: string | null
  examine: string | null
  /**
   * Where it is. Empty when the wiki doesn't say in a structured way.
   *
   * A list rather than a string because the wiki genuinely lists several for
   * some bosses — the `{{LocLine}}` rows are a table of spawns. Collapsing to
   * the first would silently drop the others.
   */
  locations: string[]
  /** Slayer categories from the infobox's `cat`, e.g. "Hellhounds". */
  slayerCategories: string[]
  /**
   * Quest ids this boss **appears in**, from the infobox's `quest` field.
   *
   * Deliberately not "requires". The field says where the NPC turns up —
   * Delrith in Demon Slayer, Sigmund in The Lost Tribe — which is usually a
   * quest you fight them during rather than a gate you must pass first.
   *
   * There is no reliable source for "what do I need to fight this", and three
   * were measured before settling for this one; see ROADMAP.md Phase 7.
   *
   * Carries the name alongside the id, denormalised on purpose: the boss panel
   * would otherwise have to pull in the 474 KB quest dataset to render a
   * link's text, which is a bad trade for 23 bosses' worth of strings. The id
   * is the link target and stays the join key.
   */
  questAppearances: { id: string; name: string }[]
  versions: BossVersion[]
}

/**
 * `questAppearances` inverted: quest id -> the bosses that appear in it.
 *
 * Emitted by `build-bosses` as its own small file (20 quests, a few KB) rather
 * than derived in the app, because the only consumer is quest detail and
 * loading `bosses.json` there would cost 91 KB to render three links. It is
 * also not merged into `quests.json`: `build-quests` runs first and knows
 * nothing about bosses, so writing it there would invert the dependency.
 */
export interface QuestBossIndex {
  generatedAt: string
  byQuest: Record<string, { id: string; name: string }[]>
}

/** Generated artifact shape for src/data/bosses.json. */
export interface BossDataset {
  generatedAt: string
  sources: string[]
  bosses: Boss[]
}

/**
 * One row of a drop table.
 *
 * Everything is a string because the wiki's own values are: quantity is
 * "2-3" or "5-15 (noted)", rarity is "Always" or "5/150" or "1/1000". Parsing
 * those into numbers would mean inventing a representation for ranges and
 * noted quantities, and then rendering them back into the same strings.
 */
export interface BossDrop {
  name: string
  quantity: string | null
  rarity: string | null
  /** How many times the table is rolled for this item, when it says. */
  rolls: number | null
}

/** A drop table: one section of one boss's drops. */
export interface BossDropTable {
  /** The wiki heading above it — "100%", "Weapons and armour", "Tertiary". */
  section: string | null
  /**
   * Which version of the boss drops this, from `{{DropsTableHead|dropversion}}`.
   * Vorkath's pre- and post-quest forms have different tables, so flattening
   * these together would show a player drops they cannot get.
   */
  version: string | null
  drops: BossDrop[]
}

/**
 * Everything about one boss that is too big to bundle, served from
 * `public/boss-detail/<id>.json`.
 *
 * Fetched on demand rather than bundled, following the quest-guides precedent:
 * the set is another `diaries.json` of precache to ship every player 183 boss
 * pages they read one at a time. See CLAUDE.md.
 *
 * Named for what it is rather than for its first occupant — it held only drop
 * tables for about an hour, and a file called `drops` carrying fight prose is
 * how a directory ends up lying about its contents.
 */
export interface BossDetail {
  /** The boss id this belongs to. Checked on load — see the guides store. */
  id: string
  name: string
  wikiUrl: string
  /**
   * The wiki's "Fight overview" section as paragraphs — what the boss does to
   * you, in prose.
   *
   * Deliberately *not* the `<boss>/Strategies` subpage, which is 34–47 KB of
   * gear setups and tables per boss and a different product entirely. This is
   * the paragraph you want on a second screen mid-fight; that is a guide you
   * read beforehand, and the wiki is better at it.
   */
  overview: string[]
  tables: BossDropTable[]
}

/* ------------------------------------------------------------ quest guides */

/**
 * One bullet of a quick guide's walkthrough.
 *
 * Shaped like `QuestItemLine` on purpose — plain text plus a nesting depth —
 * because the source is the same kind of wiki bullet list and the same reading
 * applies: a sub-bullet is a detail hanging off the line above, not a step of
 * its own. Kept a separate interface anyway, since `chat` has no meaning for an
 * item line and `heading` has none here.
 */
export interface QuestGuideStep {
  /** Plain text, wiki markup already stripped. */
  text: string
  /** Nesting depth in the wiki's bullet list; omitted at top level. */
  depth?: number
  /**
   * The dialogue options to pick, in order, written as "1. Yes."
   *
   * Extracted from `{{Chat option}}` before the text is flattened, because
   * `plainText` strips unknown templates wholesale and this one carries the
   * instruction rather than decorating it — "talk to Alec Kincade" without the
   * options is a step you have to work out again at the keyboard.
   */
  chat?: string[]
}

/**
 * A chapter of a walkthrough, from a `===`/`====` heading on the quick guide.
 *
 * Short quests have none at all — Cook's Assistant is nine bullets under no
 * heading — so `title` is null for the one implicit section those produce. Long
 * ones have up to 15, which is what makes them navigable: Desert Treasure II is
 * 249 bullets, and an undivided list of that length is not a guide.
 */
export interface QuestGuideSection {
  /** Null for the implicit section of a guide that uses no headings. */
  title: string | null
  /** Heading depth: 0 for `===`, 1 for `====`. Omitted at top level. */
  depth?: number
  /**
   * Prose between the heading and the checklist — most often a per-section
   * "Items required:" line, which is load-bearing and appears nowhere in the
   * quest's own item list.
   */
  notes: string[]
  steps: QuestGuideStep[]
}

/**
 * One quest's walkthrough, emitted to `public/guides/<id>.json`.
 *
 * Per-quest files rather than one dataset, and fetched on demand rather than
 * precached: together these are ~900 KB of wiki prose, which would roughly
 * double the precache for content the player reads one quest at a time. See
 * CLAUDE.md's bundle invariants.
 */
export interface QuestGuide {
  /** The quest id in `quests.json`. */
  id: string
  /** ISO date this guide was generated. */
  generatedAt: string
  /** The `/Quick guide` page this came from, for attribution. */
  sourceUrl: string
  sections: QuestGuideSection[]
}
