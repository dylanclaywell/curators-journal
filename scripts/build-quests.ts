/**
 * Generates src/data/quests.json from the OSRS Wiki.
 *
 * Why the wiki and not an API: quest requirements have no official source.
 * Jagex's hiscores expose skills and activities only. Of the wiki's three
 * candidate sources, per-quest-page templates won — the wiki has no queryable
 * database extension, and `Module:Questreq/data` runs 21 quests behind and
 * omits exactly the newest ones. ROADMAP.md carries the full reasoning.
 *
 * Built in stages so parsing can be iterated without re-fetching:
 *
 *   1. Fetch the canonical inventory and every quest page's wikitext to
 *      `.cache/wiki/pages.json`.  (done)
 *   2. Parse templates and requirements to `.cache/wiki/parsed.json`, and
 *      report anything that didn't reduce cleanly.  (done)
 *   3. Cross-check against `Module:Questreq/data` and validate the graph.
 *   4. Emit `src/data/quests.json`.
 *
 * Unlike `fetch-skill-icons.mjs`, this **fails loud**. A missing icon degrades
 * to a hidden image; a missing quest silently removes it from the queue, which
 * is the app's whole purpose. Never emit a partial dataset.
 *
 *   npm run build:quests            # uses the cache when present
 *   npm run build:quests -- --refresh
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// The app's own types, so the generator cannot drift from the shapes the
// client consumes. Node needs the explicit extension when stripping types.
import { SKILL_NAMES } from '../src/lib/types.ts'
import type { SkillName, SkillRequirement } from '../src/lib/types.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = `${root}.cache/wiki`

const API = 'https://oldschool.runescape.wiki/api.php'

/** The wiki asks API consumers to identify themselves. */
const USER_AGENT =
  'StageScape/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/stagescape)'

const headers = { 'user-agent': USER_AGENT }

/**
 * The two templates that define what counts as a quest. The wiki's own quest
 * lists are generated from pages using these, so asking which pages embed them
 * yields the canonical inventory — and splits quests from miniquests for free,
 * with no hand-maintained list to fall out of date.
 */
const INVENTORY_TEMPLATES = {
  quest: 'Template:Infobox Quest',
  miniquest: 'Template:Infobox Miniquest',
} as const

type QuestKind = keyof typeof INVENTORY_TEMPLATES

/** Titles per wikitext request. 50 is the API's limit for unauthenticated use. */
const BATCH_SIZE = 50

const REQUEST_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3

export interface CachedPage {
  title: string
  kind: QuestKind
  /** Lets a later run detect that a page changed without diffing content. */
  revisionId: number
  wikitext: string
}

export interface WikiCache {
  /** Epoch ms, so a stale cache is obvious in the log. */
  fetchedAt: number
  pages: CachedPage[]
}

/**
 * A single API call with a timeout and backoff. The wiki is a volunteer-run
 * shared resource: retry transient failures a couple of times, honour
 * Retry-After when offered, and give up loudly rather than hammering it.
 */
async function api(params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    ...params,
  })
  const url = `${API}?${query}`

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (response.ok) {
        const body = (await response.json()) as { error?: { info?: string } }
        // The API answers 200 with an `error` member for bad parameters.
        if (body.error)
          throw new Error(`wiki API error: ${body.error.info ?? 'unknown'}`)
        return body
      }

      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error(
          `wiki API returned ${response.status} for ${params.list ?? params.prop}`,
        )
      }

      const retryAfter = Number(response.headers.get('retry-after'))
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : attempt * 1000
      console.warn(`  ${response.status} from the wiki, retrying in ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`  request failed (${reason}), retrying`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
  throw new Error('unreachable')
}

/** Every mainspace page embedding a template, following continuations. */
async function pagesEmbedding(template: string): Promise<string[]> {
  const titles: string[] = []
  let continueFrom: string | undefined

  do {
    const body = (await api({
      action: 'query',
      list: 'embeddedin',
      eititle: template,
      einamespace: '0',
      eilimit: '500',
      ...(continueFrom ? { eicontinue: continueFrom } : {}),
    })) as {
      query?: { embeddedin?: { title: string }[] }
      continue?: { eicontinue?: string }
    }

    for (const page of body.query?.embeddedin ?? []) titles.push(page.title)
    continueFrom = body.continue?.eicontinue
  } while (continueFrom)

  if (!titles.length)
    throw new Error(`no pages embed ${template} — has it been renamed?`)
  return titles
}

/** Current wikitext for many titles, batched to respect the API's limits. */
async function fetchWikitext(
  titles: string[],
): Promise<Map<string, { revisionId: number; wikitext: string }>> {
  const out = new Map<string, { revisionId: number; wikitext: string }>()

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE)
    const body = (await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content|ids',
      rvslots: 'main',
      titles: batch.join('|'),
    })) as {
      query?: {
        pages?: {
          title: string
          missing?: boolean
          revisions?: {
            revid: number
            slots?: { main?: { content?: string } }
          }[]
        }[]
      }
    }

    for (const page of body.query?.pages ?? []) {
      const revision = page.revisions?.[0]
      const wikitext = revision?.slots?.main?.content
      // Loud, not skipped: a page we were told exists but can't read would
      // silently drop a quest from the dataset.
      if (page.missing || !revision || wikitext === undefined) {
        throw new Error(
          `no wikitext for "${page.title}" — inventory and content disagree`,
        )
      }
      out.set(page.title, { revisionId: revision.revid, wikitext })
    }

    console.log(
      `  fetched ${Math.min(i + BATCH_SIZE, titles.length)}/${titles.length} pages`,
    )
  }

  const missing = titles.filter((t) => !out.has(t))
  if (missing.length)
    throw new Error(`missing wikitext for: ${missing.join(', ')}`)
  return out
}

/** Stage 1: the canonical inventory plus every page's wikitext. */
async function fetchAll(): Promise<WikiCache> {
  const pages: CachedPage[] = []

  for (const [kind, template] of Object.entries(INVENTORY_TEMPLATES) as [
    QuestKind,
    string,
  ][]) {
    const titles = await pagesEmbedding(template)
    console.log(`${kind}: ${titles.length} pages embed ${template}`)

    const contents = await fetchWikitext(titles)
    for (const title of titles) {
      const content = contents.get(title)!
      pages.push({
        title,
        kind,
        revisionId: content.revisionId,
        wikitext: content.wikitext,
      })
    }
  }

  return { fetchedAt: Date.now(), pages }
}

async function readCache(): Promise<WikiCache | null> {
  try {
    return JSON.parse(
      await readFile(`${cacheDir}/pages.json`, 'utf8'),
    ) as WikiCache
  } catch {
    return null
  }
}

/* ---------------------------------------------------- stage 2: parse pages */

/**
 * Extracts a template's raw body by brace matching from its opening tag.
 *
 * Deliberately not a regex: requirement blocks nest templates and links
 * several deep, and `\{\{Quest details(.*?)\}\}` stops at the first inner
 * `}}`, silently truncating the requirements.
 */
function templateBody(text: string, name: string): string | null {
  const start = text.indexOf(`{{${name}`)
  if (start === -1) return null

  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++
      i++
      continue
    }
    if (text[i] === '}' && text[i + 1] === '}') {
      depth--
      if (depth === 0) return text.slice(start + 2 + name.length, i)
      i++
    }
  }
  return null
}

/**
 * Splits a template body into named params, breaking only at nesting depth 0
 * so a `|` inside a nested template or link doesn't start a bogus param.
 */
function templateParams(body: string | null): Record<string, string> {
  if (!body) return {}

  const parts: string[] = []
  let depth = 0
  let buf = ''

  for (let i = 0; i < body.length; i++) {
    const pair = body.slice(i, i + 2)
    if (pair === '{{' || pair === '[[') {
      depth++
      buf += pair
      i++
      continue
    }
    if (pair === '}}' || pair === ']]') {
      depth--
      buf += pair
      i++
      continue
    }
    if (body[i] === '|' && depth === 0) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += body[i]
  }
  parts.push(buf)

  const out: Record<string, string> = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim()
  }
  return out
}

/** Wiki title -> stable slug id. Must stay stable: completions reference it. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Strips wiki markup so a note reads as plain prose in the UI. */
function plainText(wikitext: string): string {
  return wikitext
    .replace(/<!--[\s\S]*?-->/g, '') // editor notes, e.g. "DO NOT ADD 30 FIREMAKING"
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>([\s\S]*?)<\/ref>/g, ' ($1)') // keep the caveat, drop the markup
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1') // [[Target|label]] -> label
    .replace(/\[\[([^\]]*)\]\]/g, '$1') // [[Target]] -> Target
    .replace(/\{\{SCP\|([^|}]+)\|(\d+)[^}]*\}\}/gi, '$1 $2') // {{SCP|Agility|62}} -> Agility 62
    .replace(/\{\{[^{}]*\}\}/g, '') // drop remaining templates
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Headers that introduce a list of prerequisite quests. The wiki mostly uses
 * one phrasing, with four one-off variants.
 */
const QUEST_LIST_HEADER =
  /^(completion of|must have completed) the following quests?:?$/i

/**
 * Guards against the reverse relation. Shilo Village's page says "Completion
 * of Shilo Village is required for the following quests:" — those are its
 * dependents, and reading them as prerequisites would invert the graph.
 */
const REVERSE_RELATION = /is required for/i

const SKILL_SET: ReadonlySet<string> = new Set(SKILL_NAMES)

interface ParsedRequirements {
  skills: SkillRequirement[]
  quests: { title: string; completion: 'finished' | 'started' }[]
  questPoints?: number
  combatLevel?: number
  notes: string[]
}

/**
 * Parses the `requirements` param, which is free wikitext but conventionally
 * templated. Four shapes appear in practice:
 *
 *   1. A bulleted list of `{{SCP|Skill|Level}}` with optional annotations.
 *   2. A "Completion of the following quests:" header over a nested list,
 *      where deeper nesting is *transitive* expansion — only the shallowest
 *      tier under the header is a direct prerequisite.
 *   3. Inline prose with no bullets at all (Family Pest).
 *   4. The literal "None" (Alfred Grimhand's Barcrawl).
 *
 * Anything it can't reduce to a checkable requirement becomes a note rather
 * than being dropped: "the ability to defeat a level 83 dragon" is a real
 * requirement that no program can evaluate, and hiding it would let the app
 * call a quest startable when it isn't.
 */
function parseRequirements(raw: string | undefined): ParsedRequirements {
  const result: ParsedRequirements = { skills: [], quests: [], notes: [] }
  if (!raw) return result

  const trimmed = raw.trim()
  if (!trimmed || /^none\.?$/i.test(trimmed)) return result

  // Shape 3: no bullets anywhere, so treat the whole value as one entry.
  const lines = /^\s*\*/m.test(trimmed)
    ? trimmed.split('\n').filter((line) => line.trim().startsWith('*'))
    : [`*${trimmed.replace(/\n+/g, ' ')}`]

  let headerDepth: number | null = null

  for (const line of lines) {
    const depth = (line.match(/^\**/) ?? [''])[0].length
    const content = line.replace(/^\**\s*/, '').trim()
    if (!content) continue

    if (QUEST_LIST_HEADER.test(plainText(content))) {
      headerDepth = depth
      continue
    }
    if (REVERSE_RELATION.test(content)) {
      headerDepth = null
      continue
    }

    /**
     * A line naming several skills is a disjunction, not a requirement:
     * While Guthix Sleeps wants "Attack + Strength >= 130, OR Attack 99, OR
     * Strength 99". Taking the first one would demand 99 Attack outright.
     * Ambiguity becomes a visible note rather than false certainty.
     */
    const scpCount = (content.match(/\{\{SCP\|/gi) ?? []).length
    if (scpCount > 1) {
      result.notes.push(plainText(content))
      continue
    }

    // Skill and pseudo-skill requirements.
    const scp = content.match(/\{\{SCP\|([^|}]+)\|(\d+)/i)
    if (scp) {
      const name = scp[1].trim()
      const level = Number(scp[2])

      if (SKILL_SET.has(name)) {
        result.skills.push({
          skill: name as SkillName,
          level,
          boostable: /\{\{Boostable\|yes\}\}/i.test(content)
            ? true
            : /\{\{Boostable\|no\}\}/i.test(content)
              ? false
              : null,
          requiredToStart: /\{\{Questreqstart\|yes\}\}/i.test(content)
            ? true
            : /\{\{Questreqstart\|no\}\}/i.test(content)
              ? false
              : null,
        })
        continue
      }
      // "Quest" is the wiki's label for quest points; "Combat" for combat level.
      if (/^quest$/i.test(name)) {
        result.questPoints = level
        continue
      }
      if (/^combat$/i.test(name)) {
        result.combatLevel = level
        continue
      }
      result.notes.push(plainText(content))
      continue
    }

    // Prerequisite quests: a link at the tier directly under a header, or an
    // inline "Completion of [[X]]" / "Started [[X]]".
    const link = content.match(/\[\[([^\]|#]+)/)
    const inHeaderTier = headerDepth !== null && depth === headerDepth + 1
    // The wiki writes an inline prerequisite five different ways.
    const inlineCompletion =
      /^(partial completion of|completion of|completed|started|must have completed)\b/i.test(
        content,
      )

    if (link && (inHeaderTier || inlineCompletion)) {
      // "Started X", "Partial completion of X" and "X up until ..." all mean
      // the prerequisite need only be begun, not finished.
      const started = /^(started|partial completion of)\b/i.test(content)
      result.quests.push({
        title: link[1].trim(),
        completion: started ? 'started' : 'finished',
      })
      // Inline forms often carry extra conditions worth showing verbatim.
      if (inlineCompletion && /\b(up until|partway|after)\b/i.test(content)) {
        result.notes.push(plainText(content))
      }
      continue
    }

    // Deeper than the header tier: transitive prerequisites, already implied.
    if (link && headerDepth !== null && depth > headerDepth + 1) continue

    result.notes.push(plainText(content))
  }

  result.notes = result.notes.filter(Boolean)
  return result
}

const DIFFICULTIES: ReadonlySet<string> = new Set([
  'Novice',
  'Intermediate',
  'Experienced',
  'Master',
  'Grandmaster',
  'Special',
])

const LENGTHS: ReadonlySet<string> = new Set([
  'Very Short',
  'Short',
  'Medium',
  'Long',
  'Very Long',
])

/**
 * Pages that are not quests despite using a quest infobox.
 *
 * Recipe for Disaster's parent is excluded because its ten subquests are the
 * real entries: Monkey Madness II requires one of them specifically, and the
 * parent reports the union of their requirements plus the *sum* of their quest
 * points, which would double-count. `/Full guide` is a walkthrough page.
 */
const EXCLUDED_PAGES: ReadonlySet<string> = new Set([
  'Recipe for Disaster',
  'Recipe for Disaster/Full guide',
])

/** Multi-part quests whose subpages are grouped for display only. */
const GROUP_PREFIXES = ['Recipe for Disaster/']

interface ParsedPage {
  id: string
  title: string
  name: string
  kind: QuestKind
  difficulty: string | null
  length: string | null
  questPoints: number
  members: boolean
  group: string | null
  requirements: ParsedRequirements
  wikiUrl: string
  /** Collected for the report rather than thrown, so one run shows every issue. */
  defects: string[]
}

function parsePage(page: CachedPage): ParsedPage {
  const infobox = templateParams(
    templateBody(
      page.wikitext,
      page.kind === 'miniquest' ? 'Infobox Miniquest' : 'Infobox Quest',
    ),
  )
  const details = templateParams(templateBody(page.wikitext, 'Quest details'))
  const rewards = templateParams(templateBody(page.wikitext, 'Quest rewards'))
  const defects: string[] = []

  const difficulty = details.difficulty?.trim() ?? ''
  if (!DIFFICULTIES.has(difficulty)) {
    // The template documents six words and requires the field. Numbers appear
    // on three miniquest pages; guessing a mapping would invent data.
    defects.push(
      difficulty
        ? `difficulty is ${JSON.stringify(difficulty)}, not one of the six documented values`
        : 'no difficulty',
    )
  }

  const length = details.length?.trim() ?? ''
  if (length && !LENGTHS.has(length))
    defects.push(`unexpected length ${JSON.stringify(length)}`)

  const questPoints = Number(rewards.qp ?? 0)
  if (page.kind === 'quest' && !rewards.qp) defects.push('no quest points')

  const prefix = GROUP_PREFIXES.find((p) => page.title.startsWith(p))
  const series = infobox.series?.trim()
  const group = prefix
    ? prefix.replace(/\/$/, '')
    : series && !/^none$/i.test(series)
      ? // "[[Quests/Series#Kharidian|Kharidian]], #4" -> "Kharidian", and
        // "[[Gnome quest series]]" -> "Gnome". The position within a series is
        // dropped: the group is a display label, not an ordering.
        plainText(series)
          .replace(/,\s*#\d+\s*$/, '')
          .replace(/\s+quest series$/i, '')
          .trim() || null
      : null

  return {
    id: slugify(page.title),
    title: page.title,
    // Subpage titles carry the parent; the infobox name is what to display.
    name: plainText(infobox.name ?? '') || page.title,
    kind: page.kind,
    difficulty: DIFFICULTIES.has(difficulty) ? difficulty : null,
    length: LENGTHS.has(length) ? length : null,
    questPoints: Number.isFinite(questPoints) ? questPoints : 0,
    members: /^yes$/i.test(infobox.members?.trim() ?? ''),
    group,
    requirements: parseRequirements(details.requirements),
    wikiUrl: `https://oldschool.runescape.wiki/w/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    defects,
  }
}

/* ----------------------------------- stage 3: cross-check and validation */

const QUESTREQ_MODULE = 'Module:Questreq/data'

interface LuaEntry {
  quests: { title: string; completion: 'finished' | 'started' }[]
  skills: { name: string; level: number; flags: string[] }[]
}

/**
 * Parses `Module:Questreq/data` — a hand-maintained Lua table backing
 * `Template:Questreq`. It is NOT the dataset's source: it runs behind the
 * canonical page list and carries non-quests. It is kept as an independent
 * second opinion, because it's maintained by different people in a different
 * format, so the two disagreeing is a signal worth reading.
 *
 * When they disagree, **the page wins and generation continues** — the page is
 * what a player sees if they check the wiki themselves, so matching it keeps the
 * app from contradicting the source they'd consult. This check exists to find
 * bugs in our parser, not to referee the two sources.
 *
 * Tokenized rather than parsed by indentation: the file mixes tabs and spaces,
 * and an indentation-based parser silently reads only a fraction of it.
 */
function parseQuestreq(source: string): Map<string, LuaEntry> {
  const body = source.slice(source.indexOf('local questReqs'))
  const BACKSLASH = String.fromCharCode(92)

  type Token =
    { t: 'str'; v: string } | { t: 'num'; v: number } | { t: '{' | '}' }
  const toks: Token[] = []

  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "'") {
      let s = ''
      for (i++; i < body.length && body[i] !== "'"; i++) {
        if (body[i] === BACKSLASH) {
          s += body[++i]
          continue
        }
        s += body[i]
      }
      toks.push({ t: 'str', v: s })
      continue
    }
    // Skip comments: the file opens with a template example in a block comment.
    if (c === '-' && body[i + 1] === '-') {
      while (i < body.length && body[i] !== '\n') i++
      continue
    }
    if (c >= '0' && c <= '9') {
      let n = ''
      while (i < body.length && body[i] >= '0' && body[i] <= '9') n += body[i++]
      i--
      toks.push({ t: 'num', v: Number(n) })
      continue
    }
    if (c === '{' || c === '}') toks.push({ t: c })
  }

  const entries = new Map<string, LuaEntry>()
  let p = 0
  if (toks[p]?.t !== '{')
    throw new Error(`${QUESTREQ_MODULE}: expected a root table`)
  p++

  while (p < toks.length && toks[p].t !== '}') {
    const nameTok = toks[p++]
    if (nameTok.t !== 'str')
      throw new Error(`${QUESTREQ_MODULE}: expected a quest name`)
    if (toks[p++].t !== '{')
      throw new Error(`${QUESTREQ_MODULE}: expected a table for ${nameTok.v}`)

    const entry: LuaEntry = { quests: [], skills: [] }
    while (p < toks.length && toks[p].t !== '}') {
      const sectionTok = toks[p++]
      if (sectionTok.t !== 'str')
        throw new Error(`${QUESTREQ_MODULE}: expected a section name`)
      if (toks[p++].t !== '{')
        throw new Error(`${QUESTREQ_MODULE}: expected a section table`)

      while (p < toks.length && toks[p].t !== '}') {
        if (sectionTok.v === 'quests') {
          const tok = toks[p++]
          if (tok.t !== 'str') continue
          // "Started:X" means the prerequisite need only be begun. One entry
          // also carries a trailing space ("Watchtower ").
          const started = tok.v.startsWith('Started:')
          entries.set(nameTok.v, entry)
          entry.quests.push({
            title: tok.v.replace(/^Started:/, '').trim(),
            completion: started ? 'started' : 'finished',
          })
        } else {
          if (toks[p++].t !== '{')
            throw new Error(`${QUESTREQ_MODULE}: expected a skill tuple`)
          const skillTok = toks[p++]
          const levelTok = toks[p++]
          if (skillTok.t !== 'str' || levelTok.t !== 'num') {
            throw new Error(
              `${QUESTREQ_MODULE}: malformed skill tuple in ${nameTok.v}`,
            )
          }
          const flags: string[] = []
          while (p < toks.length && toks[p].t !== '}') {
            const flagTok = toks[p++]
            if (flagTok.t === 'str') flags.push(flagTok.v)
          }
          p++
          entry.skills.push({ name: skillTok.v, level: levelTok.v, flags })
        }
      }
      p++
    }
    p++
    entries.set(nameTok.v, entry)
  }

  return entries
}

async function loadQuestreq(refresh: boolean): Promise<Map<string, LuaEntry>> {
  const path = `${cacheDir}/questreq.lua`

  let source: string | null = refresh
    ? null
    : await readFile(path, 'utf8').catch(() => null)
  if (source === null) {
    const body = (await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: QUESTREQ_MODULE,
    })) as {
      query?: {
        pages?: { revisions?: { slots?: { main?: { content?: string } } }[] }[]
      }
    }
    source =
      body.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? null
    if (!source) throw new Error(`could not read ${QUESTREQ_MODULE}`)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path, source)
  }
  return parseQuestreq(source)
}

/**
 * Confirms the prerequisite graph can actually be ordered. A cycle makes the
 * dependency-ordered queue — the app's whole point — impossible to build, so
 * this is a hard failure rather than a warning.
 */
function assertAcyclic(parsed: ParsedPage[]) {
  const byId = new Map(parsed.map((p) => [p.id, p]))
  const state = new Map<string, 1 | 2>()
  const cycles: string[] = []

  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) {
      cycles.push([...path, id].join(' -> '))
      return
    }
    state.set(id, 1)
    for (const prereq of byId.get(id)?.requirements.quests ?? []) {
      const target = parsed.find((p) => p.title === prereq.title)
      if (target) visit(target.id, [...path, id])
    }
    state.set(id, 2)
  }
  for (const page of parsed) visit(page.id, [])

  if (cycles.length) {
    throw new Error(
      `prerequisite cycle(s) found, queue cannot be ordered:\n  ${cycles.join('\n  ')}`,
    )
  }

  // Longest chain, as a sanity check that the graph has real depth.
  const depths = new Map<string, number>()
  const depth = (id: string): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    depths.set(id, 1)
    const prereqs = byId.get(id)?.requirements.quests ?? []
    const value =
      1 +
      Math.max(
        0,
        ...prereqs.map((prereq) => {
          const target = parsed.find((p) => p.title === prereq.title)
          return target ? depth(target.id) : 0
        }),
      )
    depths.set(id, value)
    return value
  }
  const deepest = parsed
    .map((p) => ({ name: p.name, d: depth(p.id) }))
    .sort((a, b) => b.d - a.d)[0]

  console.log(
    `\ngraph is acyclic; deepest chain is ${deepest.d} (${deepest.name})`,
  )
}

/** Compares the page parse against the Lua module and reports disagreements. */
function crossCheck(parsed: ParsedPage[], lua: Map<string, LuaEntry>) {
  const byTitle = new Map(parsed.map((p) => [p.title, p]))
  const SKILL_DISAGREEMENTS: string[] = []
  const ironmanOnly: string[] = []
  const QUEST_DISAGREEMENTS: string[] = []

  let compared = 0
  for (const [name, entry] of lua) {
    const page = byTitle.get(name)
    // Entries with no page are the module's non-quests: achievement diaries,
    // Tutorial Island, Barbarian Training sub-tasks.
    if (!page) continue
    compared++

    const ours = new Map(
      page.requirements.skills.map((s) => [s.skill, s.level]),
    )
    const theirs = new Map(
      entry.skills
        .filter((s) => SKILL_SET.has(s.name))
        .map((s) => [s.name, s] as const),
    )
    for (const [skill, theirSkill] of theirs) {
      const mine = ours.get(skill as SkillName)
      if (mine === undefined) {
        // The module flags requirements that only apply to ironman accounts,
        // which the page keeps in a separate `ironman` param we don't parse.
        // Counted apart so real disagreements aren't buried in them.
        if (theirSkill.flags.includes('ironman'))
          ironmanOnly.push(`${name}: ${skill} ${theirSkill.level}`)
        else
          SKILL_DISAGREEMENTS.push(
            `${name}: we miss ${skill} ${theirSkill.level}`,
          )
      } else if (mine !== theirSkill.level) {
        SKILL_DISAGREEMENTS.push(
          `${name}: ${skill} ours ${mine} vs theirs ${theirSkill.level}`,
        )
      }
    }
    for (const [skill, level] of ours) {
      if (!theirs.has(skill))
        SKILL_DISAGREEMENTS.push(`${name}: only we have ${skill} ${level}`)
    }

    const ourQuests = new Set(page.requirements.quests.map((q) => q.title))
    const theirQuests = new Set(entry.quests.map((q) => q.title))
    for (const q of theirQuests) {
      if (!ourQuests.has(q) && byTitle.has(q))
        QUEST_DISAGREEMENTS.push(`${name}: we miss "${q}"`)
    }
    for (const q of ourQuests) {
      if (!theirQuests.has(q))
        QUEST_DISAGREEMENTS.push(`${name}: only we have "${q}"`)
    }
  }

  const onlyInPages = parsed.filter((p) => !lua.has(p.title))
  console.log(`\ncross-check against ${QUESTREQ_MODULE} (informational only):`)
  console.log(`  compared ${compared} entries present in both`)
  console.log(
    `  ${onlyInPages.length} pages absent from the module (it runs behind; expected)`,
  )
  console.log(
    `  ironman-only requirements the module has and pages keep elsewhere: ${ironmanOnly.length}`,
  )
  console.log(`  skill disagreements: ${SKILL_DISAGREEMENTS.length}`)
  console.log(`  prerequisite disagreements: ${QUEST_DISAGREEMENTS.length}`)

  for (const line of [...SKILL_DISAGREEMENTS, ...QUEST_DISAGREEMENTS].slice(
    0,
    40,
  )) {
    console.log(`    ${line}`)
  }
  const total = SKILL_DISAGREEMENTS.length + QUEST_DISAGREEMENTS.length
  if (total > 40) console.log(`    ... and ${total - 40} more`)

  return {
    skillDisagreements: SKILL_DISAGREEMENTS,
    questDisagreements: QUEST_DISAGREEMENTS,
  }
}

/** Stage 2: parse every cached page and report what didn't reduce cleanly. */
function parseAll(cache: WikiCache) {
  const pages = cache.pages.filter((p) => !EXCLUDED_PAGES.has(p.title))
  const parsed = pages.map(parsePage)

  const byTitle = new Map(parsed.map((p) => [p.title, p]))
  const byId = new Map<string, ParsedPage[]>()
  for (const p of parsed) byId.set(p.id, [...(byId.get(p.id) ?? []), p])

  console.log(
    `\nparsed ${parsed.length} pages (${cache.pages.length - parsed.length} excluded)`,
  )

  const collisions = [...byId.values()].filter((group) => group.length > 1)
  if (collisions.length) {
    // Ids key the user's completions, so a collision is never acceptable.
    throw new Error(
      `slug collision: ${collisions.map((g) => g.map((p) => p.title).join(' / ')).join('; ')}`,
    )
  }

  /**
   * Achievement diaries are prerequisites the wiki links like quests, but
   * they aren't quests and have no page in our inventory. They can't be graph
   * edges, so they become notes — visible to the player, absent from the
   * dependency order. Anything else that fails to resolve is a real error.
   */
  const NON_QUEST_PREREQ = /\bdiar(?:y|ies)\b/i

  const unresolved: string[] = []
  for (const page of parsed) {
    const keep: typeof page.requirements.quests = []
    for (const prereq of page.requirements.quests) {
      const normalized = prereq.title.replace(/_/g, ' ').trim()
      if (byTitle.has(normalized)) {
        keep.push({ ...prereq, title: normalized })
        continue
      }
      if (NON_QUEST_PREREQ.test(normalized)) {
        page.requirements.notes.push(`Requires ${normalized}`)
        continue
      }
      unresolved.push(`${page.title} -> ${prereq.title}`)
      keep.push(prereq)
    }
    page.requirements.quests = keep
  }

  const skills = parsed.reduce((n, p) => n + p.requirements.skills.length, 0)
  const edges = parsed.reduce((n, p) => n + p.requirements.quests.length, 0)
  const notes = parsed.reduce((n, p) => n + p.requirements.notes.length, 0)
  const started = parsed.reduce(
    (n, p) =>
      n +
      p.requirements.quests.filter((q) => q.completion === 'started').length,
    0,
  )

  console.log(`  skill requirements: ${skills}`)
  console.log(`  prerequisite edges: ${edges} (${started} need only starting)`)
  console.log(`  free-prose notes:   ${notes}`)
  console.log(
    `  unknown boostable:  ${parsed.reduce((n, p) => n + p.requirements.skills.filter((s) => s.boostable === null).length, 0)}`,
  )
  console.log(
    `  unknown start flag: ${parsed.reduce((n, p) => n + p.requirements.skills.filter((s) => s.requiredToStart === null).length, 0)}`,
  )

  const withDefects = parsed.filter((p) => p.defects.length)
  if (withDefects.length) {
    console.log(`\npage defects needing review (${withDefects.length}):`)
    for (const page of withDefects) {
      console.log(`  ${page.title}: ${page.defects.join('; ')}`)
    }
  }

  if (unresolved.length) {
    console.log(`\nunresolved prerequisites (${unresolved.length}):`)
    for (const u of unresolved) console.log(`  ${u}`)
  }

  return { parsed, unresolved }
}

async function main() {
  const refresh = process.argv.includes('--refresh')

  let cache = refresh ? null : await readCache()
  if (cache) {
    const age = Math.round((Date.now() - cache.fetchedAt) / 60_000)
    console.log(
      `using cached wikitext: ${cache.pages.length} pages, ${age} minute(s) old`,
    )
    console.log('pass --refresh to re-fetch.')
  } else {
    console.log('fetching from the OSRS Wiki...')
    cache = await fetchAll()
    await mkdir(cacheDir, { recursive: true })
    await writeFile(`${cacheDir}/pages.json`, JSON.stringify(cache))
    console.log(`cached ${cache.pages.length} pages to .cache/wiki/pages.json`)
  }

  const counts = cache.pages.reduce<Record<string, number>>((acc, page) => {
    acc[page.kind] = (acc[page.kind] ?? 0) + 1
    return acc
  }, {})
  console.log(
    `inventory: ${Object.entries(counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')}`,
  )

  const bytes = cache.pages.reduce(
    (total, page) => total + page.wikitext.length,
    0,
  )
  console.log(`wikitext: ${(bytes / 1024).toFixed(0)} KB total`)

  const { parsed } = parseAll(cache)
  await writeFile(`${cacheDir}/parsed.json`, JSON.stringify(parsed, null, 1))
  console.log(`\nwrote .cache/wiki/parsed.json for inspection`)

  assertAcyclic(parsed)
  crossCheck(parsed, await loadQuestreq(refresh))

  console.log('\nstage 3 of 4 complete. Emitting the dataset is next.')
}

main().catch((error: unknown) => {
  console.error(
    `\nbuild-quests failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  console.error(
    'No dataset was written. A partial quest dataset is worse than none.',
  )
  process.exit(1)
})
