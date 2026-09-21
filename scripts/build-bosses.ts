/**
 * Generates src/data/bosses.json from the OSRS Wiki and the hiscores.
 *
 * Unlike quests and diaries, this generator has *two* sources and neither is
 * sufficient alone:
 *
 *   - The **wiki** knows what bosses exist (~173 in Category:Bosses), and is
 *     the only place their stats, requirements and drops are written down.
 *   - The **hiscores** know which bosses Jagex publishes a kill count for (71),
 *     and own the exact spelling that count is filed under.
 *
 * So the dataset is the union, joined on page title, and every boss carries a
 * nullable `hiscoreName`. A boss with none has no kill count anywhere — not in
 * a third-party API, not in the game for most of them — and the UI says so
 * rather than showing a zero.
 *
 * **The join needs no hand-maintained mapping.** The wiki already keeps
 * redirects for nearly every spelling Jagex uses, so resolving the hiscore
 * names through the API *is* the mapping: 70 of 71 land on a page by
 * themselves. The single exception is `EXCEPTIONS` below, and anything that
 * stops resolving becomes a defect rather than a silently dropped boss.
 *
 * Fails loud, like the other generators. Never emits a partial dataset.
 *
 *   npm run build:bosses               # uses the cache when present
 *   npm run build:bosses -- --refresh  # re-fetch, ignoring the cache
 *   npm run build:bosses -- --check    # is the committed dataset stale?
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { OTHER_ACTIVITY_NAMES } from '../src/lib/bosses.ts'
import type { Boss, BossDataset, BossVersion } from '../src/lib/types.ts'

import {
  exitCodeFor,
  fetchWikitext,
  findTemplate,
  pagesInCategory,
  plainText,
  resolveTitles,
  slugify,
  templateParams,
  WikiUnreachableError,
} from './lib/wiki.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = `${root}.cache/wiki`
const dataDir = `${root}src/data`

const CATEGORY = 'Category:Bosses'

/**
 * Where the hiscores' activity names come from.
 *
 * Any valid account works — the *names* are identical for everyone, only the
 * numbers differ — so this is a well-known account chosen for being stable and
 * public rather than for its stats. The generator reads nothing but the list of
 * activity names from the response.
 */
const REFERENCE_PLAYER = 'Lynx Titan'
const HISCORES =
  'https://secure.runescape.com/m=hiscore_oldschool/index_lite.json'
const USER_AGENT =
  'CuratorsJournal/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/curators-journal)'

/**
 * Hiscore names the wiki cannot resolve on its own.
 *
 * Deliberately tiny and deliberately not a general mapping table: everything
 * else goes through the wiki's redirects, and an entry here is an admission
 * that one name has no page of any spelling. `Barrows Chests` is the only one
 * — the hiscores count chest openings, and the wiki files the encounter under
 * the minigame's name.
 *
 * A name that stops resolving is reported as a defect, *not* added here
 * automatically. Adding one is a judgement about what the hiscores are
 * counting, which is exactly the kind of thing a generator must not guess.
 */
const EXCEPTIONS: Record<string, string> = {
  'Barrows Chests': 'Barrows',
}

/* --------------------------------------------------------------- defects */

interface Defect {
  page: string
  message: string
}
const defects: Defect[] = []
function report(page: string, message: string): void {
  defects.push({ page, message })
}

/* ---------------------------------------------------- stage 1: fetch names */

/**
 * The boss rows of the hiscores activity array, by name.
 *
 * "Boss" here is everything that is not one of the ~20 points, clue and
 * minigame rows enumerated in `src/lib/bosses.ts`. Defining it by subtraction
 * rather than by an allow-list is what lets a newly released boss appear
 * without anyone editing a list — and a *new non-boss* row (a new clue tier,
 * say) shows up as a boss that won't resolve to a wiki page, which is a
 * defect, which is a human reading a message. Wrong in the loud direction.
 */
async function fetchHiscoreBossNames(): Promise<string[]> {
  const url = `${HISCORES}?player=${encodeURIComponent(REFERENCE_PLAYER)}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new WikiUnreachableError(`could not reach the hiscores: ${reason}`)
  }

  if (!response.ok) {
    const message = `the hiscores returned ${response.status}`
    // Same contract as the wiki: unreachable is not a finding.
    if (response.status === 429 || response.status >= 500)
      throw new WikiUnreachableError(message)
    throw new Error(message)
  }

  const body = (await response.json()) as {
    activities?: { name?: string }[]
  }
  const names = (body.activities ?? [])
    .map((row) => (row.name ?? '').trim())
    .filter(Boolean)

  if (names.length < 50)
    throw new Error(
      `the hiscores returned only ${names.length} activities — shape changed?`,
    )

  const others = new Set(OTHER_ACTIVITY_NAMES)
  return names.filter((name) => !others.has(name))
}

/* -------------------------------------------------------------- the cache */

interface CachedPage {
  title: string
  revisionId: number
  wikitext: string
}

interface BossCache {
  fetchedAt: number
  /** Hiscore boss name -> wiki page title. */
  hiscoreToPage: Record<string, string>
  pages: CachedPage[]
}

async function readCache(): Promise<BossCache | null> {
  try {
    return JSON.parse(
      await readFile(`${cacheDir}/bosses.json`, 'utf8'),
    ) as BossCache
  } catch {
    return null
  }
}

async function fetchAll(): Promise<BossCache> {
  console.log(`reading activity names from the hiscores (${REFERENCE_PLAYER})`)
  const hiscoreNames = await fetchHiscoreBossNames()
  console.log(`  ${hiscoreNames.length} boss rows`)

  console.log(`resolving them against the wiki`)
  const { resolved, missing } = await resolveTitles(hiscoreNames)

  const hiscoreToPage: Record<string, string> = {}
  for (const [name, title] of resolved) hiscoreToPage[name] = title
  for (const name of missing) {
    const exception = EXCEPTIONS[name]
    if (exception) {
      hiscoreToPage[name] = exception
      continue
    }
    report(
      name,
      'the hiscores publish a count under this name but the wiki has no such ' +
        'page. Add it to EXCEPTIONS with the page it belongs to, or check ' +
        'whether it is a boss at all.',
    )
  }
  const redirected = [...resolved.entries()].filter(
    ([name, title]) => name !== title,
  )
  console.log(
    `  ${resolved.size} resolved (${redirected.length} via redirects), ` +
      `${missing.length} needed an exception`,
  )

  console.log(`listing ${CATEGORY}`)
  const categoryTitles = await pagesInCategory(CATEGORY)
  console.log(`  ${categoryTitles.length} pages`)

  const titles = [
    ...new Set([...categoryTitles, ...Object.values(hiscoreToPage)]),
  ].sort()
  console.log(`fetching ${titles.length} pages`)
  const wikitext = await fetchWikitext(titles)

  return {
    fetchedAt: Date.now(),
    hiscoreToPage,
    pages: [...wikitext.entries()].map(([title, page]) => ({
      title,
      revisionId: page.revisionId,
      wikitext: page.wikitext,
    })),
  }
}

/* ------------------------------------------------------- stage 2: parsing */

/** `[[Slash]], [[Magic]]` -> ["Slash", "Magic"]. */
function splitList(value: string | undefined): string[] {
  if (!value) return []
  return plainText(value)
    .split(/,|\band\b/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== 'n/a')
}

/**
 * A numeric infobox value, or null when the wiki doesn't state one.
 *
 * **Anchored to the start, and refs stripped first.** Raid bosses scale with
 * the party, so the wiki writes `combat = N/A<ref>DISCLAIMER: The stats
 * displayed on this page can vary…</ref>`, and a search for the first digit
 * anywhere in that string is a search of the footnote. Today the disclaimer
 * happens to contain no digits; the day someone edits a number into it, six
 * raid bosses silently acquire a combat level. So: drop the ref, then accept a
 * value only when the number is the whole point of it.
 *
 * `N/A` and `No` are legitimate answers meaning "this monster has none" —
 * Koschei the deathless cannot be killed — and come back as null, the same as
 * an absent field but for a different reason.
 */
function numberOrNull(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const match = /^-?\d[\d,]*(\.\d+)?/.exec(cleaned)
  if (!match) return null
  const n = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function boolOrFalse(value: string | undefined): boolean {
  return /^yes/i.test((value ?? '').trim())
}

/**
 * Pulls the versioned parameters out of one `{{Infobox Monster}}`.
 *
 * The wiki's convention is a bare `combat` when there is one version and
 * `combat1`, `combat2`, … alongside `version1`, `version2`, … when there are
 * several. Both spellings appear on the same page, so a reader that only knows
 * one of them silently returns nothing — which would look exactly like a boss
 * with no stats.
 */
function readVersions(params: Record<string, string>): BossVersion[] {
  const labels: string[] = []
  for (let i = 1; ; i++) {
    const label = params[`version${i}`]
    if (label === undefined) break
    labels.push(plainText(label))
  }

  const pick = (key: string, index: number | null): string | undefined =>
    index === null ? params[key] : (params[`${key}${index}`] ?? params[key])

  const build = (label: string | null, index: number | null): BossVersion => ({
    label,
    combatLevel: numberOrNull(pick('combat', index)),
    hitpoints: numberOrNull(pick('hitpoints', index)),
    maxHit: pick('max hit', index) ? plainText(pick('max hit', index)!) : null,
    attackStyles: splitList(pick('attack style', index)),
    attackSpeed: numberOrNull(pick('attack speed', index)),
    slayerLevel: numberOrNull(pick('slaylvl', index)),
    slayerXp: numberOrNull(pick('slayxp', index)),
  })

  if (!labels.length) return [build(null, null)]
  return labels.map((label, i) => build(label, i + 1))
}

interface ParsedPage {
  title: string
  members: boolean
  examine: string | null
  slayerCategories: string[]
  versions: BossVersion[]
  /** False when the page carries no `{{Infobox Monster}}` at all. */
  hasInfobox: boolean
}

/**
 * Reads a boss page.
 *
 * A page with no `{{Infobox Monster}}` is **not** a defect: raids and some
 * multi-phase encounters are documented as places rather than as monsters, and
 * Chambers of Xeric genuinely has no combat level. Those come back with no
 * versions and are reported as a count, not as errors — the distinction being
 * that an expected absence should not train anyone to ignore the defect list.
 */
function parsePage(page: CachedPage): ParsedPage {
  const match =
    findTemplate(page.wikitext, 'Infobox Monster') ??
    findTemplate(page.wikitext, 'Infobox monster')

  if (!match) {
    return {
      title: page.title,
      members: /\|\s*members\s*=\s*yes/i.test(page.wikitext),
      examine: null,
      slayerCategories: [],
      versions: [],
      hasInfobox: false,
    }
  }

  const params = templateParams(match.body)
  const versions = readVersions(params)

  /*
   * The defect is a *missing field*, not a missing number.
   *
   * `combat = N/A` is the wiki being accurate: the Chambers of Xeric room
   * bosses scale with the party, and Koschei the deathless has `combat = No`
   * because he cannot be killed. Reporting those was the first version of this
   * check and it produced seven defects that were all correct data — which is
   * how a defect list stops being read. What genuinely means the template moved
   * under us is the parameter not being there at all.
   */
  const hasCombatField =
    params.combat !== undefined ||
    Object.keys(params).some((key) => /^combat\d+$/.test(key))
  if (!hasCombatField) {
    report(page.title, 'has an Infobox Monster with no combat parameter at all')
  }

  return {
    title: page.title,
    members: boolOrFalse(params.members),
    examine: params.examine ? plainText(params.examine) : null,
    slayerCategories: splitList(params.cat).filter(
      (cat) => cat.toLowerCase() !== 'bosses',
    ),
    versions,
    hasInfobox: true,
  }
}

/* ------------------------------------------------------- stage 3: the join */

function buildBosses(
  parsed: ParsedPage[],
  hiscoreToPage: Record<string, string>,
): Boss[] {
  /*
   * Several hiscore rows can share one page — `Tombs of Amascut: Expert Mode`
   * resolves to `Tombs of Amascut`, `The Corrupted Gauntlet` to `The
   * Gauntlet`. They are separate encounters with separate counts, so they get
   * separate entries pointing at the same page. The one whose name *is* the
   * page title is the base; the others are variants of it.
   */
  const rowsByPage = new Map<string, string[]>()
  for (const [name, title] of Object.entries(hiscoreToPage)) {
    const rows = rowsByPage.get(title) ?? []
    rows.push(name)
    rowsByPage.set(title, rows)
  }

  const bosses: Boss[] = []

  for (const page of parsed) {
    const rows = rowsByPage.get(page.title) ?? []
    const base =
      rows.find((name) => name === page.title) ??
      rows.find((name) => !name.includes(':')) ??
      rows[0] ??
      null

    const common = {
      page: page.title,
      wikiUrl: `https://oldschool.runescape.wiki/w/${encodeURIComponent(
        page.title.replace(/ /g, '_'),
      )}`,
      members: page.members,
      examine: page.examine,
      slayerCategories: page.slayerCategories,
      versions: page.versions,
    }

    const baseId = slugify(page.title)
    bosses.push({
      id: baseId,
      name: page.title,
      hiscoreName: base,
      variantOf: null,
      ...common,
    })

    for (const name of rows) {
      if (name === base) continue
      bosses.push({
        id: slugify(name),
        name,
        hiscoreName: name,
        variantOf: baseId,
        ...common,
      })
    }
  }

  // Every hiscore row must have found a home, or a kill count the app fetches
  // has nowhere to land and quietly disappears from the panel.
  const placed = new Set(
    bosses.map((boss) => boss.hiscoreName).filter(Boolean) as string[],
  )
  for (const name of Object.keys(hiscoreToPage)) {
    if (!placed.has(name))
      report(name, `resolved to "${hiscoreToPage[name]}" but no page was read`)
  }

  // Ids are the join key for anything the player may later own (a favourite, a
  // note), so a collision is unfixable after the fact.
  const seen = new Set<string>()
  for (const boss of bosses) {
    if (seen.has(boss.id)) report(boss.name, `duplicate id "${boss.id}"`)
    seen.add(boss.id)
  }

  return bosses.sort((a, b) => a.name.localeCompare(b.name))
}

/* ----------------------------------------------------------------- emit */

async function emit(bosses: Boss[], pages: CachedPage[]): Promise<void> {
  const generatedAt = new Date().toISOString().slice(0, 10)

  const dataset: BossDataset = {
    generatedAt,
    sources: [
      `https://oldschool.runescape.wiki/w/${CATEGORY.replace(/ /g, '_')} (boss pages, CC BY-NC-SA 3.0)`,
      'https://secure.runescape.com/m=hiscore_oldschool/index_lite.json (activity names)',
    ],
    bosses,
  }

  const revisions: Record<string, number> = {}
  for (const page of [...pages].sort((a, b) => a.title.localeCompare(b.title)))
    revisions[page.title] = page.revisionId

  await writeFile(
    `${dataDir}/bosses.json`,
    JSON.stringify(dataset, null, 2) + '\n',
  )
  await writeFile(
    `${dataDir}/bosses.sources.json`,
    JSON.stringify({ generatedAt, revisions }, null, 2) + '\n',
  )

  const tracked = bosses.filter((boss) => boss.hiscoreName).length
  const statless = bosses.filter((boss) => !boss.versions.length).length
  console.log(`\nwrote ${bosses.length} bosses`)
  console.log(`  ${tracked} with a hiscore kill count`)
  console.log(`  ${bosses.length - tracked} documented only`)
  console.log(`  ${statless} with no Infobox Monster (raids and the like)`)
}

/* ---------------------------------------------------------------- --check */

async function checkForDrift(): Promise<number> {
  const lock = JSON.parse(
    await readFile(`${dataDir}/bosses.sources.json`, 'utf8'),
  ) as { generatedAt: string; revisions: Record<string, number> }

  const hiscoreNames = await fetchHiscoreBossNames()
  const { resolved } = await resolveTitles(hiscoreNames)
  const categoryTitles = await pagesInCategory(CATEGORY)
  const titles = [
    ...new Set([
      ...categoryTitles,
      ...resolved.values(),
      ...Object.values(EXCEPTIONS),
    ]),
  ]

  const live = await fetchWikitext(titles)

  const moved: string[] = []
  for (const [title, page] of live) {
    const known = lock.revisions[title]
    if (known === undefined) moved.push(`+ ${title} (new)`)
    else if (known !== page.revisionId) moved.push(`~ ${title}`)
  }
  for (const title of Object.keys(lock.revisions)) {
    if (!live.has(title)) moved.push(`- ${title} (gone)`)
  }

  console.log(`generated: ${lock.generatedAt}`)
  console.log(`boss pages: ${live.size}`)
  if (!moved.length) {
    console.log('the dataset matches the wiki')
    return 0
  }
  console.log(`pages edited since: ${moved.length}`)
  for (const line of moved.slice(0, 20)) console.log(`  ${line}`)
  if (moved.length > 20) console.log(`  ... and ${moved.length - 20} more`)
  console.log('\nthe dataset is behind the wiki. Regenerate with:')
  console.log('  npm run build:bosses -- --refresh')
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
    await writeFile(`${cacheDir}/bosses.json`, JSON.stringify(cache))
  } else {
    console.log(
      `using cached pages from ${new Date(cache.fetchedAt).toISOString().slice(0, 10)}`,
    )
  }

  const parsed = cache.pages.map(parsePage)
  const bosses = buildBosses(parsed, cache.hiscoreToPage)

  if (defects.length) {
    console.error(`\n${defects.length} defect(s):`)
    for (const d of defects.slice(0, 40))
      console.error(`  ${d.page}: ${d.message}`)
    if (defects.length > 40)
      console.error(`  ... and ${defects.length - 40} more`)
    throw new Error('refusing to emit a dataset with unresolved defects')
  }

  await emit(bosses, cache.pages)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = exitCodeFor(error)
})
