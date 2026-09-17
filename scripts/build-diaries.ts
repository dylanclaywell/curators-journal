/**
 * Generates src/data/diaries.json from the OSRS Wiki.
 *
 * Same reasoning as build-quests.ts — there is no API for this, the wiki has no
 * queryable database extension, and the app has to work offline. See ROADMAP.md
 * Phase 6, and CLAUDE.md on why `sync.runescape.wiki` is not an option.
 *
 * Diary pages are markedly better structured than quest pages: all 12 carry
 * exactly four tiers, each tier's aggregate requirements sit in a
 * `{{DiarySkillStats}}` template, and each task table is tagged with
 * `data-diary-name` / `data-diary-tier`. So this parses tables rather than
 * prose, and gets a cross-check the quest generator had to go looking for:
 *
 *   - Tier requirements come from `{{DiarySkillStats}}`.
 *   - Task requirements come from each row's own cell.
 *   - The two must agree — a tier's stated level is the max over its tasks.
 *     The wiki maintains both by hand, so they drift, and disagreement is
 *     reported rather than silently resolved.
 *
 * Quest prerequisites are resolved against src/data/quests.json. An unresolvable
 * quest name fails the build: a dropped prerequisite would report a blocked
 * tier as available, which is the failure this app exists to avoid.
 *
 * Fails loud, like build-quests.ts. Never emits a partial dataset.
 *
 *   npm run build:diaries               # uses the cache when present
 *   npm run build:diaries -- --refresh  # re-fetch, ignoring the cache
 *   npm run build:diaries -- --check    # is the committed dataset stale?
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DIARY_TIERS, SKILL_NAMES } from '../src/lib/types.ts'
import type {
  Diary,
  DiaryDataset,
  DiaryTask,
  DiaryTier,
  DiaryTierName,
  QuestDataset,
  QuestItemLine,
  QuestPrerequisite,
  QuestRequirements,
  SkillName,
  SkillRequirement,
} from '../src/lib/types.ts'

import {
  api,
  BATCH_SIZE,
  fetchWikitext,
  pagesEmbedding,
  plainText,
  slugify,
  templateBody,
  templateParams,
} from './lib/wiki.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = `${root}.cache/wiki`
const dataDir = `${root}src/data`

/**
 * The template every diary page embeds. Two pages embed it that are not
 * diaries — `Steam Achievements` and a user archive — so the inventory is
 * filtered by title rather than trusted wholesale.
 */
const INVENTORY_TEMPLATE = 'Template:Infobox Achievement Diary'

const TIER_SET: ReadonlySet<string> = new Set(DIARY_TIERS)

interface CachedPage {
  title: string
  revisionId: number
  wikitext: string
}

interface DiaryCache {
  fetchedAt: number
  pages: CachedPage[]
}

/* ---------------------------------------------------- stage 1: fetch pages */

async function fetchAll(): Promise<DiaryCache> {
  const titles = (await pagesEmbedding(INVENTORY_TEMPLATE)).filter((t) =>
    t.endsWith(' Diary'),
  )
  console.log(`${titles.length} diary pages embed ${INVENTORY_TEMPLATE}`)
  if (titles.length !== 12) {
    throw new Error(
      `expected 12 diaries, found ${titles.length}: ${titles.join(', ')}`,
    )
  }

  const contents = await fetchWikitext(titles)
  return {
    fetchedAt: Date.now(),
    pages: titles.map((title) => {
      const content = contents.get(title)!
      return {
        title,
        revisionId: content.revisionId,
        wikitext: content.wikitext,
      }
    }),
  }
}

async function readCache(): Promise<DiaryCache | null> {
  try {
    return JSON.parse(
      await readFile(`${cacheDir}/diaries.json`, 'utf8'),
    ) as DiaryCache
  } catch {
    return null
  }
}

/* --------------------------------------------------- wikitable navigation */

/**
 * The wikitext of the table starting at `from`, excluding the `{|` and `|}`.
 *
 * Brace-matched rather than regex-matched because diary pages nest tables: the
 * Overview tabber puts a stats table inside a layout table, and a lazy match
 * for `|}` ends the outer table at the inner one's close.
 */
function tableAt(text: string, from: number): string | null {
  const start = text.indexOf('{|', from)
  if (start === -1) return null

  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '|') {
      depth++
      i++
      continue
    }
    if (text[i] === '|' && text[i + 1] === '}') {
      depth--
      if (depth === 0) return text.slice(start + 2, i)
      i++
    }
  }
  return null
}

/**
 * Splits table wikitext on row separators at nesting depth 0.
 *
 * Depth matters: `{{Map|...}}` writes `|x:2683,...` at the start of a line, and
 * a naive split on `^\|-` or `^\|` would treat a map pin as a table row.
 */
function splitAtDepth(
  body: string,
  isBreak: (line: string) => boolean,
  /**
   * Whether the breaking line is itself data. Row separators (`|-`) are pure
   * punctuation, but a cell marker carries its cell's first line of content
   * (`|1. Have Wizard Cromperty teleport you...`) — dropping it loses the task.
   */
  keepBreakLine: boolean,
) {
  const out: string[] = []
  let buf: string[] = []
  let depth = 0

  for (const line of body.split('\n')) {
    if (depth === 0 && isBreak(line)) {
      out.push(buf.join('\n'))
      buf = keepBreakLine ? [line.replace(/^[|!]+/, '')] : []
      depth += countOpeners(line)
      continue
    }
    buf.push(line)
    depth += countOpeners(line)
  }
  out.push(buf.join('\n'))
  return out.filter((s) => s.trim())
}

function countOpeners(line: string): number {
  const open = (line.match(/\{\{|\{\|/g) ?? []).length
  const close = (line.match(/\}\}|\|\}/g) ?? []).length
  return open - close
}

const rowsOf = (body: string) =>
  splitAtDepth(body, (l) => /^\|-/.test(l), false)

const cellsOf = (row: string) =>
  splitAtDepth(row, (l) => /^[|!]/.test(l) && !/^\|[-}]/.test(l), true)

/* ------------------------------------------------- stage 2: parse the page */

interface Defect {
  page: string
  message: string
}

const defects: Defect[] = []
const report = (page: string, message: string) =>
  defects.push({ page, message })

/**
 * Link targets the wiki writes as redirects, which slugify to ids the quest
 * dataset doesn't have. Kept explicit and tiny rather than resolved over the
 * network: the parse stage runs offline from cache, and a silent
 * near-miss here would drop a prerequisite.
 */
const QUEST_ALIASES: Record<string, string> = {
  // Not a redirect: the parent RFD page is not a dataset entry, only its ten
  // subquests are. 'Full completion of Recipe for Disaster' is exactly
  // completion of the finale, which the quest graph already gates on all nine
  // others — so the transitive part needs no special handling here.
  'recipe-for-disaster': 'recipe-for-disaster-defeating-the-culinaromancer',
  'recipe-for-disaster-king-awowogei':
    'recipe-for-disaster-freeing-king-awowogei',
  'recipe-for-disaster-sir-amik-varze':
    'recipe-for-disaster-freeing-sir-amik-varze',
  'recipe-for-disaster-pirate-pete': 'recipe-for-disaster-freeing-pirate-pete',
  'recipe-for-disaster-evil-dave': 'recipe-for-disaster-freeing-evil-dave',
  'recipe-for-disaster-skrach-uglogwee':
    'recipe-for-disaster-freeing-skrach-uglogwee',
  'recipe-for-disaster-goblin-generals':
    'recipe-for-disaster-freeing-the-goblin-generals',
  'recipe-for-disaster-lumbridge-guide':
    'recipe-for-disaster-freeing-the-lumbridge-guide',
  'recipe-for-disaster-mountain-dwarf':
    'recipe-for-disaster-freeing-the-mountain-dwarf',
}

/**
 * Resolves a wiki link target to a quest id, or returns null.
 *
 * Normalization is tried rather than assumed, because the article is
 * load-bearing in both directions: "the Heroes' Quest" is `heroes-quest`, but
 * "The Knight's Sword" really is `the-knights-sword`. Guessing one rule would
 * break the other, so each candidate is checked against the dataset.
 */
function questIdFor(
  name: string,
  questIds: ReadonlySet<string>,
): string | null {
  const base = slugify(name)
  const candidates = [
    base,
    QUEST_ALIASES[base],
    base.replace(/^the-/, ''),
    base.replace(/-quest$/, ''),
    base.replace(/^the-/, '').replace(/-quest$/, ''),
    name.includes('/') ? slugify(name.split('/').pop()!) : undefined,
  ]
  for (const id of candidates) if (id && questIds.has(id)) return id
  return null
}

/** Every `[[target]]` / `[[target|label]]` in a line, in order. */
function linkTargets(line: string): string[] {
  return [...line.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  )
}

const EMPTY_REQUIREMENTS = (): QuestRequirements => ({ skills: [], quests: [] })

/**
 * Parses a `{{DiarySkillStats}}` body into a tier's stated requirements.
 *
 * Params are `Skill = level`, plus `Quest = N` for quest *points* (not a
 * skill — naming it `Quest` is the wiki's choice, and reading it as one would
 * invent a 25th skill), `Total` for the displayed sum, and `<Skill>Notes` for
 * ironman and boost caveats that stay as prose.
 */
function parseTierStats(
  body: string | null,
  page: string,
  totalQuestPoints: number,
): { requirements: QuestRequirements; notes: string[] } {
  const params = templateParams(body)
  const requirements = EMPTY_REQUIREMENTS()
  const notes: string[] = []

  for (const [rawKey, rawValue] of Object.entries(params)) {
    const value = rawValue.trim()
    if (!value) continue

    if (rawKey.endsWith('notes')) {
      const text = plainText(value)
      if (text) notes.push(text)
      continue
    }

    /*
     * Lumbridge & Draynor Elite states `Quest = {{Globals|quest points}}` —
     * every quest point in the game, a number that moves with each update.
     * Taking the dataset's own total is the only self-consistent reading: it
     * is what "all quests" means to an app that only knows these quests. It
     * can understate after a game update and before a regeneration, so the
     * note says plainly what the number is, rather than presenting a stale
     * total as the real requirement.
     */
    if (rawKey === 'quest' && /\{\{Globals/i.test(value)) {
      requirements.questPoints = totalQuestPoints
      notes.push(
        `Requires every quest point in the game — ${totalQuestPoints} across ` +
          `the quests this app knows about, as of the dataset's generation.`,
      )
      continue
    }
    // Display flags for the template, not data.
    if (DISPLAY_PARAMS.has(rawKey)) continue

    const level = Number(value.replace(/[^\d]/g, ''))
    if (!Number.isFinite(level) || level <= 0) {
      report(page, `unreadable DiarySkillStats value: ${rawKey} = "${value}"`)
      continue
    }

    if (rawKey === 'quest') {
      requirements.questPoints = level
      continue
    }
    if (rawKey === 'combat') {
      requirements.combatLevel = level
      continue
    }

    const skill = SKILL_NAMES.find((s) => s.toLowerCase() === rawKey)
    if (!skill) {
      report(page, `unknown DiarySkillStats key: "${rawKey}"`)
      continue
    }
    requirements.skills.push({
      skill,
      level,
      // The wiki states boostability per task, not per tier. Claiming `false`
      // here would assert something the tier block never says.
      boostable: null,
      // Diaries have no start/finish split: a task is done or it isn't.
      requiredToStart: null,
    })
  }

  requirements.skills.sort((a, b) => a.skill.localeCompare(b.skill))
  return { requirements, notes }
}

/**
 * Params that style the DiarySkillStats box rather than state a requirement.
 * Kept as an explicit set so an unrecognised key is still reported: a new
 * *skill* param arriving as noise is exactly the silent loss to avoid.
 */
const DISPLAY_PARAMS = new Set([
  'total',
  'maxrefs',
  'boostable',
  'selectable',
  'margin',
])

/**
 * Parses one task's requirement cell.
 *
 * Bullets reduce to three kinds: a skill level, a quest prerequisite, or
 * something we cannot compute on. The third is the common case for items and
 * access, and it stays as prose rather than being forced into a shape.
 */
function parseTaskRequirements(
  cell: string,
  questIds: ReadonlySet<string>,
  page: string,
): Pick<DiaryTask, 'requirements' | 'items' | 'notes'> {
  const requirements = EMPTY_REQUIREMENTS()
  const items: QuestItemLine[] = []
  const notes: string[] = []

  for (const raw of cell.split('\n')) {
    const bullet = raw.match(/^(\*+)\s*(.+)$/)
    if (!bullet) continue
    const depth = bullet[1].length - 1
    const line = bullet[2].trim()

    /*
     * {{SCP|Skill|level}} — every one in the bullet, not just the first:
     * "{{SCP|Woodcutting|10}} and {{SCP|Agility|12}}" states two requirements
     * and matching once silently drops the second.
     *
     * Not every mention is a requirement, though, and the wiki's own tier
     * totals are the evidence: Karamja Medium says Agility 32 while a task
     * mentions Agility 79. The 79 is an *alternative* — "[[Machete]] or
     * {{SCP|Agility|79}}" — and counting it would report a task as blocked for
     * a player holding the machete. Three shapes are soft rather than hard:
     *
     *   - an alternative, where "or" immediately precedes the template
     *   - an explicit "recommended"
     *   - a sub-bullet, which explains its parent rather than adding to it
     *
     * Soft mentions keep their prose so the player still sees the number.
     */
    const scps = [...line.matchAll(/\{\{SCP\|([^|}]+)\|([\d,]+)/gi)]
    if (scps.length) {
      let handled = false
      for (const scp of scps) {
        const key = scp[1].trim()
        const level = Number(scp[2].replace(/,/g, ''))
        if (!Number.isFinite(level)) continue

        const before = line.slice(0, scp.index)
        const after = line.slice(scp.index)
        // "or" on either side makes this one of several routes, not the
        // requirement: "{{SCP|Agility|60}} or {{SCP|Strength|60}}" is a choice,
        // and counting the first would gate the task on a skill the player can
        // substitute. Looking only backwards would catch the second and miss
        // the first.
        const afterTemplate = after.slice(after.indexOf('}}') + 2)
        const isAlternative =
          /\bor\s*$/i.test(plainText(before)) ||
          /^\s*,?\s*or\b/i.test(afterTemplate)
        const isRecommended = /^[^*]{0,40}\brecommended\b/i.test(
          plainText(after).slice(0, 60),
        )
        /*
         * A level inside parentheses is a caveat on the requirement, not the
         * requirement: "{{SCP|Farming|23}} (Ironman accounts require
         * {{SCP|Farming|47}})" asks for 23, and 47 only of an ironman. Taking
         * the higher number would block the task for everyone else.
         *
         * This is where diary ironman requirements go — the same deferral
         * ROADMAP.md records for quests, and for the same reason: the prose is
         * kept so the player still sees the number.
         */
        const openParens =
          (before.match(/\(/g) ?? []).length -
          (before.match(/\)/g) ?? []).length
        const soft =
          depth > 0 || isAlternative || isRecommended || openParens > 0

        const skill = SKILL_NAMES.find(
          (s) => s.toLowerCase() === key.toLowerCase(),
        )
        if (skill) {
          handled = true
          if (!soft) {
            requirements.skills.push({
              skill,
              level,
              boostable: /\{\{boostable(?!\|n)/i.test(line) ? true : null,
              requiredToStart: null,
            })
          }
          continue
        }
        if (key.toLowerCase() === 'quest') {
          handled = true
          if (!soft) requirements.questPoints = level
          continue
        }
        if (key.toLowerCase() === 'combat') {
          handled = true
          if (!soft) requirements.combatLevel = level
          continue
        }
        report(page, `unknown SCP skill in task: "${key}"`)
      }

      // A bullet whose numbers were all soft still carries information, and a
      // bullet naming a skill alongside an item ("a machete, or Agility 79")
      // is also an item line — so it falls through to the prose handling
      // below rather than being consumed here.
      if (handled && !/\bor\b/i.test(plainText(line)) && depth === 0) continue
    }

    // {{SCP|Quest}} followed by prose naming one or more quests.
    if (/\{\{SCP\|Quest/i.test(line)) {
      const text = plainText(line)
      const targets = linkTargets(line)
      const resolved = targets
        .map((t) => ({ target: t, id: questIdFor(t, questIds) }))
        .filter((r) => r.id)

      for (const { target, id } of resolved) {
        // Completion is decided from the words immediately before this link,
        // not from the line as a whole: "Completion of [[The Fremennik
        // Trials]] and having started [[Fairytale II]]" states a different
        // requirement for each of its two quests.
        const before = line.slice(0, line.indexOf(`[[${target}`)).toLowerCase()
        const lastClause = before.split(/\band\b|,/).pop() ?? before
        requirements.quests.push({
          id: id!,
          // "Started" and "Partial completion of" both mean the quest need not
          // be finished — the distinction the quest dataset already carries,
          // reused rather than reinvented.
          completion: /\b(start|started|starting|partial)\b/.test(lastClause)
            ? 'started'
            : 'finished',
        })
      }

      // Anything the line mentions that isn't a quest we know — the Knight
      // Waves Training Grounds, a Combat Achievements tier — is a real
      // requirement we cannot compute on, so the prose is kept rather than the
      // line being dropped on the floor.
      if (text && resolved.length !== targets.length) notes.push(text)
      else if (text && !resolved.length) notes.push(text)
      continue
    }

    const text = plainText(line)
    if (!text) continue
    // Footnote and ironman caveats read as conditions, not as items to bring.
    if (/^(ironmen|ultimate ironmen|note:)/i.test(text)) notes.push(text)
    else items.push(depth ? { text, depth } : { text })
  }

  dedupeSkills(requirements)
  return { requirements, items, notes }
}

/**
 * Collapses a repeated skill within one task to its **lowest** level.
 *
 * Counter-intuitive next to the tier aggregation, which takes the maximum —
 * but a single task naming one skill twice can only be offering alternative
 * routes, since needing both 45 and 35 of something is just needing 45. The
 * Fremennik snowy knight is the example: "Hunter 45" bare-handed, or "Hunter
 * 35 with a butterfly net". The net is the cheaper route and the wiki's own
 * tier total agrees, quoting 35.
 */
function dedupeSkills(requirements: QuestRequirements) {
  const best = new Map<SkillName, SkillRequirement>()
  for (const s of requirements.skills) {
    const prior = best.get(s.skill)
    if (!prior || s.level < prior.level) best.set(s.skill, s)
    else if (prior && s.boostable === true) prior.boostable = true
  }
  requirements.skills = [...best.values()].sort((a, b) =>
    a.skill.localeCompare(b.skill),
  )
}

function dedupeQuests(quests: QuestPrerequisite[]): QuestPrerequisite[] {
  const best = new Map<string, QuestPrerequisite>()
  for (const q of quests) {
    const prior = best.get(q.id)
    // "finished" subsumes "started": needing it done implies needing it begun.
    if (
      !prior ||
      (prior.completion === 'started' && q.completion === 'finished')
    )
      best.set(q.id, q)
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** A tier's task table, located by the attributes the wiki tags it with. */
function taskTableFor(
  wikitext: string,
  tier: DiaryTierName,
  page: string,
): string | null {
  const marker = new RegExp(`data-diary-tier="${tier}"`, 'i')
  const at = wikitext.search(marker)
  if (at === -1) {
    report(page, `no task table tagged data-diary-tier="${tier}"`)
    return null
  }
  // Walk back to this table's own `{|`, which precedes the attribute.
  const open = wikitext.lastIndexOf('{|', at)
  if (open === -1) {
    report(page, `task table for ${tier} has no opening {|`)
    return null
  }
  return tableAt(wikitext, open)
}

function parseTasks(
  wikitext: string,
  tier: DiaryTierName,
  questIds: ReadonlySet<string>,
  page: string,
): DiaryTask[] {
  const table = taskTableFor(wikitext, tier, page)
  if (!table) return []

  const tasks: DiaryTask[] = []
  for (const row of rowsOf(table)) {
    const cells = cellsOf(row)
    if (cells.length < 1) continue

    // Header rows carry `!` cells and no numbered task.
    const first = cells[0].replace(/^\|/, '').trim()
    const numbered = first.match(/^(\d+)\.\s*([\s\S]*)$/)
    if (!numbered) continue

    const text = plainText(numbered[2].replace(/''Note:[\s\S]*$/i, ''))
    const inlineNote = numbered[2].match(/''Note:([\s\S]*?)''/i)

    const parsed = parseTaskRequirements(
      cells[1] ? cells[1].replace(/^\|/, '') : '',
      questIds,
      page,
    )
    if (inlineNote) {
      const note = plainText(inlineNote[1])
      if (note) parsed.notes.unshift(note)
    }
    parsed.requirements.quests = dedupeQuests(parsed.requirements.quests)

    if (!text) {
      report(page, `${tier} task ${numbered[1]} has no readable text`)
      continue
    }
    tasks.push({ text, ...parsed })
  }
  return tasks
}

/** The `===Rewards===` bullets inside a tier's section. */
function parseRewards(section: string): QuestItemLine[] {
  const at = section.search(/^===\s*Rewards\s*===/m)
  if (at === -1) return []
  const out: QuestItemLine[] = []
  for (const raw of section.slice(at).split('\n').slice(1)) {
    if (/^=/.test(raw)) break
    const bullet = raw.match(/^(\*+)\s*(.+)$/)
    if (!bullet) continue
    const text = plainText(bullet[2])
    if (!text) continue
    const depth = bullet[1].length - 1
    out.push(depth ? { text, depth } : { text })
  }
  return out
}

/** The wikitext between `==Tier==` and the next `==` heading. */
function sectionFor(wikitext: string, tier: DiaryTierName): string {
  const start = wikitext.search(new RegExp(`^==\\s*${tier}\\s*==`, 'm'))
  if (start === -1) return ''
  const rest = wikitext.slice(start + 1)
  const end = rest.search(/^==[^=]/m)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * The Overview tabber holds one `{{DiarySkillStats}}` per tier, in tier order,
 * alongside a quest-requirement table per tier. Both are keyed by position
 * within the tabber rather than by an attribute, which is the one place this
 * page shape is weaker than the task tables.
 */
function parseOverview(
  wikitext: string,
  page: string,
  totalQuestPoints: number,
): Map<DiaryTierName, { requirements: QuestRequirements; notes: string[] }> {
  const out = new Map<
    DiaryTierName,
    { requirements: QuestRequirements; notes: string[] }
  >()

  for (const tier of DIARY_TIERS) {
    const marker = new RegExp(`^\\|-\\|\\s*\\n?${tier}\\s*=`, 'm')
    const at = wikitext.search(marker)
    if (at === -1) {
      report(page, `Overview tabber has no "${tier}=" pane`)
      out.set(tier, { requirements: EMPTY_REQUIREMENTS(), notes: [] })
      continue
    }
    const next = DIARY_TIERS.map((t) =>
      wikitext
        .slice(at + 1)
        .search(new RegExp(`^\\|-\\|\\s*\\n?${t}\\s*=`, 'm')),
    ).filter((i) => i >= 0)
    const end = next.length ? Math.min(...next) + 1 : wikitext.length
    const pane = wikitext.slice(at, at + end)

    const stats = parseTierStats(
      templateBody(pane, 'DiarySkillStats'),
      page,
      totalQuestPoints,
    )

    // Quest requirements sit in a table of `data-rowid="Quest Name"` rows.
    // Titles here, resolved in parsePage where the dataset is in scope.
    for (const m of pane.matchAll(/data-rowid="([^"]+)"/g)) {
      stats.requirements.quests.push({ id: m[1], completion: 'finished' })
    }

    // "Additional requirements" tables hold started/partial states as prose.
    for (const m of pane.matchAll(
      /^\|\s*(Started|Partial completion of)\s+\[\[([^\]|]+)/gim,
    )) {
      stats.requirements.quests.push({ id: m[2], completion: 'started' })
    }

    out.set(tier, stats)
  }
  return out
}

interface ParsedDiary {
  diary: Diary
  revisionId: number
}

function parsePage(
  page: CachedPage,
  questIds: ReadonlySet<string>,
  totalQuestPoints: number,
): ParsedDiary {
  const { title, wikitext } = page
  const info = templateParams(
    templateBody(wikitext, 'Infobox Achievement Diary'),
  )
  const name = plainText(info.name ?? title) || title
  const id = slugify(name.replace(/\s+Diary$/i, ''))

  const overview = parseOverview(wikitext, title, totalQuestPoints)

  const tiers: DiaryTier[] = DIARY_TIERS.map((tier) => {
    const stated = overview.get(tier)!
    const section = sectionFor(wikitext, tier)
    const tasks = parseTasks(wikitext, tier, questIds, title)

    if (!tasks.length) report(title, `${tier} yielded no tasks`)

    // The tier's quest prerequisites are wiki titles until now. Resolving them
    // here keeps both sources on one failure path — and an unresolvable title
    // in the Overview block is a real defect, unlike one inside a task cell:
    // this table lists nothing but quests, so a miss means the parse is wrong
    // rather than that the wiki mentioned something uncomputable.
    const resolved: QuestPrerequisite[] = []
    for (const q of stated.requirements.quests) {
      const questId = questIdFor(q.id, questIds)
      if (questId) resolved.push({ id: questId, completion: q.completion })
      else report(title, `${tier}: unresolvable quest requirement "${q.id}"`)
    }
    stated.requirements.quests = dedupeQuests(resolved)

    return {
      id: `${id}-${tier.toLowerCase()}`,
      tier,
      requirements: stated.requirements,
      tasks,
      notes: stated.notes,
      rewards: parseRewards(section),
    }
  })

  return {
    revisionId: page.revisionId,
    diary: {
      id,
      name,
      areas: (info.areas ? plainText(info.areas) : '')
        .split(/,\s*|\s+and\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
      members: /yes/i.test(info.members ?? ''),
      taskmaster: plainText(info.taskmasters ?? ''),
      tiers,
      wikiUrl: `https://oldschool.runescape.wiki/w/${encodeURIComponent(
        title.replace(/ /g, '_'),
      )}`,
    },
  }
}

/* ------------------------------------------------- stage 3: the cross-check */

/**
 * A tier's stated skill requirement should be the maximum over its tasks.
 *
 * Both numbers are hand-maintained on the wiki, so they drift — and the drift
 * is informative in both directions. A stated level *below* the task maximum
 * would make the app call a tier reachable when a task inside it isn't, which
 * is the direction that costs something, so it is reported loudly. The reverse
 * usually means a task's cell omits a requirement the tier block remembers.
 */
function crossCheck(diaries: Diary[]) {
  let disagreements = 0

  for (const diary of diaries) {
    for (const tier of diary.tiers) {
      const fromTasks = new Map<SkillName, number>()
      for (const task of tier.tasks) {
        for (const s of task.requirements.skills) {
          fromTasks.set(s.skill, Math.max(fromTasks.get(s.skill) ?? 0, s.level))
        }
      }

      for (const stated of tier.requirements.skills) {
        const observed = fromTasks.get(stated.skill)
        if (observed === undefined) continue
        if (observed > stated.level) {
          disagreements++
          console.warn(
            `  ${tier.id}: tasks need ${stated.skill} ${observed}, tier states ${stated.level}`,
          )
        }
      }
    }
  }

  if (disagreements) {
    console.warn(
      `\n  ${disagreements} tier/task disagreement(s) — the tier block is the ` +
        `shipped number; tasks are shown alongside it.`,
    )
  }
  return disagreements
}

/* ------------------------------------------------------- stage 4: emit */

interface SourceLock {
  generatedAt: string
  revisions: Record<string, number>
}

async function emit(parsed: ParsedDiary[]) {
  const generatedAt = new Date().toISOString().slice(0, 10)
  const dataset: DiaryDataset = {
    generatedAt,
    sources: parsed.map((p) => p.diary.wikiUrl),
    diaries: parsed.map((p) => p.diary),
  }

  const lock: SourceLock = {
    generatedAt,
    revisions: Object.fromEntries(
      parsed.map((p) => [p.diary.name, p.revisionId]),
    ),
  }

  await mkdir(dataDir, { recursive: true })
  const json = JSON.stringify(dataset)
  await writeFile(`${dataDir}/diaries.json`, json)
  await writeFile(
    `${dataDir}/diaries.sources.json`,
    JSON.stringify(lock, null, 2) + '\n',
  )

  const tasks = dataset.diaries.reduce(
    (n, d) => n + d.tiers.reduce((m, t) => m + t.tasks.length, 0),
    0,
  )
  console.log(
    `\nwrote src/data/diaries.json — ${dataset.diaries.length} diaries, ` +
      `${dataset.diaries.length * 4} tiers, ${tasks} tasks, ` +
      `${Math.round(json.length / 1024)} KB minified`,
  )
  console.log('wrote src/data/diaries.sources.json (revision ids, not shipped)')
}

/* -------------------------------------------------------- drift detection */

async function checkForDrift(): Promise<number> {
  let lock: SourceLock
  try {
    lock = JSON.parse(
      await readFile(`${dataDir}/diaries.sources.json`, 'utf8'),
    ) as SourceLock
  } catch {
    console.error('no diaries.sources.json — run the generator first')
    return 1
  }

  const titles = (await pagesEmbedding(INVENTORY_TEMPLATE)).filter((t) =>
    t.endsWith(' Diary'),
  )
  const live = new Map<string, number>()
  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const body = (await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'ids',
      titles: titles.slice(i, i + BATCH_SIZE).join('|'),
    })) as {
      query?: { pages?: { title: string; revisions?: { revid: number }[] }[] }
    }
    for (const page of body.query?.pages ?? []) {
      const revid = page.revisions?.[0]?.revid
      if (revid) live.set(page.title, revid)
    }
  }

  const moved: string[] = []
  for (const [title, revid] of live) {
    const name = title.replace(/\s+Diary$/i, ' Diary')
    const known = lock.revisions[name] ?? lock.revisions[title]
    if (known === undefined) moved.push(`+ ${title} (new)`)
    else if (known !== revid) moved.push(`~ ${title}`)
  }
  for (const name of Object.keys(lock.revisions)) {
    if (![...live.keys()].some((t) => t === name))
      moved.push(`- ${name} (gone)`)
  }

  console.log(`generated: ${lock.generatedAt}`)
  console.log(`diary pages: ${live.size}`)
  if (!moved.length) {
    console.log('the dataset matches the wiki')
    return 0
  }
  console.log(`pages edited since: ${moved.length}`)
  for (const line of moved.slice(0, 20)) console.log(`  ${line}`)
  if (moved.length > 20) console.log(`  ... and ${moved.length - 20} more`)
  console.log('\nthe dataset is behind the wiki. Regenerate with:')
  console.log('  npm run build:diaries -- --refresh')
  return 1
}

/* ------------------------------------------------------------------ main */

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--check')) {
    process.exitCode = await checkForDrift()
    return
  }

  const refresh = args.includes('--refresh')
  let cache = refresh ? null : await readCache()
  if (!cache) {
    cache = await fetchAll()
    await mkdir(cacheDir, { recursive: true })
    await writeFile(`${cacheDir}/diaries.json`, JSON.stringify(cache))
  } else {
    console.log(
      `using cached pages from ${new Date(cache.fetchedAt).toISOString().slice(0, 10)}`,
    )
  }

  const quests = JSON.parse(
    await readFile(`${dataDir}/quests.json`, 'utf8'),
  ) as QuestDataset
  const questIds = new Set(quests.quests.map((q) => q.id))
  const totalQuestPoints = quests.quests.reduce((n, q) => n + q.questPoints, 0)
  console.log(
    `resolving quest prerequisites against ${questIds.size} quests ` +
      `(${totalQuestPoints} quest points)`,
  )

  const parsed = cache.pages.map((page) =>
    parsePage(page, questIds, totalQuestPoints),
  )

  for (const { diary } of parsed) {
    if (diary.tiers.length !== 4)
      report(diary.name, `expected 4 tiers, got ${diary.tiers.length}`)
    for (const tier of diary.tiers) {
      if (!TIER_SET.has(tier.tier))
        report(diary.name, `unknown tier "${tier.tier}"`)
    }
  }

  if (defects.length) {
    console.error(`\n${defects.length} defect(s):`)
    for (const d of defects.slice(0, 40))
      console.error(`  ${d.page}: ${d.message}`)
    if (defects.length > 40)
      console.error(`  ... and ${defects.length - 40} more`)
    throw new Error('refusing to emit a dataset with unresolved defects')
  }

  console.log('\ncross-checking tier requirements against their tasks:')
  crossCheck(parsed.map((p) => p.diary))

  await emit(parsed)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
