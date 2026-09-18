/**
 * Generates public/guides/<id>.json from the OSRS Wiki's `/Quick guide` pages.
 *
 * These are the wiki's own condensed walkthroughs — a nested bullet list per
 * quest, chaptered by heading on the long ones. 212 of our 214 quests have one;
 * the two that don't fall back to the wiki link the quest detail already shows.
 *
 * **One file per quest, and not precached.** Together these are ~930 KB of
 * wikitext, which is more than `quests.json` and `diaries.json` combined. Rolled
 * into one dataset and precached like those two, they would roughly double what
 * the service worker downloads on install — for prose the player reads one quest
 * at a time. So they are emitted as separate static assets, fetched on demand
 * and cached as they're opened. See CLAUDE.md's bundle invariants.
 *
 * **Run this after `build:quests`.** Ids and page titles both come from
 * `quests.sources.json`, so a stale quest list silently skips a renamed quest
 * rather than failing — the guide for it just never appears.
 *
 * Built in stages so parsing can be iterated without re-fetching:
 *
 *   1. Fetch every `<quest>/Quick guide` to `.cache/wiki/guides.json`.
 *   2. Parse each page's `==Walkthrough==` into sections and steps.
 *   3. Emit `public/guides/<id>.json` plus a revision-id lock.
 *
 * Unlike the quest dataset, a missing guide is survivable — the quest detail
 * degrades to the wiki link, which is what it did before this existed. So a page
 * that fails to parse is reported and skipped rather than failing the build. A
 * *widespread* parse failure still has to be loud, which is what the coverage
 * floor below is for.
 *
 *   npm run build:guides            # uses the cache when present
 *   npm run build:guides -- --refresh   # re-fetch, ignoring the cache
 *   npm run build:guides -- --check     # are the committed guides stale?
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import type {
  QuestGuide,
  QuestGuideSection,
  QuestGuideStep,
} from '../src/lib/types.ts'

import {
  api,
  BATCH_SIZE,
  exitCodeFor,
  findTemplate,
  plainText,
  slugify,
  templateParts,
} from './lib/wiki.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = `${root}.cache/wiki`
const dataDir = `${root}src/data`
const outDir = `${root}public/guides`

/** Quick guides live at this subpage of the quest page. */
const SUBPAGE = '/Quick guide'

/**
 * Below this share of *parsable* pages yielding a guide, the parser broke
 * rather than the wiki having moved.
 *
 * Measured against the pages that claim to be guides — 204 of them today, all
 * 204 parsing — and not against all 214 quests, because the other ten are a
 * fact about the wiki (two have no page, eight redirect to the quest) and
 * folding them in would leave real breakage room to hide behind a denominator
 * we don't control. One page changing shape is ordinary churn; a twentieth of
 * them doing it at once means a template was renamed, and shipping that quietly
 * would show "no walkthrough" across most of the app as though it were true.
 */
const MIN_COVERAGE = 0.95

interface CachedGuide {
  /** The `/Quick guide` page title. */
  title: string
  /** The quest id in `quests.json`. */
  id: string
  revisionId: number
  wikitext: string
}

interface GuideCache {
  fetchedAt: number
  guides: CachedGuide[]
  /** Quests whose `/Quick guide` page does not exist. Expected, not an error. */
  absent: string[]
}

/* ------------------------------------------------ stage 0: what to fetch */

interface QuestRef {
  id: string
  title: string
}

/**
 * The quests to look for guides for, read from the quest dataset's lock rather
 * than from `quests.json` itself.
 *
 * The lock is the only file carrying canonical *page titles* — `quests.json`
 * stores display names, and for the ten Recipe for Disaster subquests those
 * differ ("Freeing Evil Dave" against "Recipe for Disaster/Freeing Evil Dave").
 * Asking the wiki for the display name's subpage 404s on all ten.
 */
async function questRefs(): Promise<QuestRef[]> {
  const lock = JSON.parse(
    await readFile(`${dataDir}/quests.sources.json`, 'utf8'),
  ) as { revisions: Record<string, number> }

  const dataset = JSON.parse(
    await readFile(`${dataDir}/quests.json`, 'utf8'),
  ) as { quests: { id: string }[] }
  const ids = new Set(dataset.quests.map((q) => q.id))

  const refs = Object.keys(lock.revisions).map((title) => ({
    id: slugify(title),
    title,
  }))

  // `slugify` is how the quest generator derived those ids in the first place,
  // so a mismatch means the two have drifted apart — which would file a guide
  // under an id no quest has, where nothing would ever read it.
  const orphans = refs.filter((ref) => !ids.has(ref.id))
  if (orphans.length) {
    throw new Error(
      `quest lock and dataset disagree on ids: ${orphans
        .map((o) => `${o.title} -> ${o.id}`)
        .join(', ')} — regenerate with build:quests first`,
    )
  }

  return refs.sort((a, b) => a.id.localeCompare(b.id))
}

/* --------------------------------------------------------- stage 1: fetch */

async function fetchAll(refs: QuestRef[]): Promise<GuideCache> {
  const guides: CachedGuide[] = []
  const absent: string[] = []
  const byTitle = new Map(refs.map((ref) => [`${ref.title}${SUBPAGE}`, ref]))
  const titles = [...byTitle.keys()]

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
      const ref = byTitle.get(page.title)
      // The API normalizes titles, so an unrecognised one means our mapping is
      // wrong rather than the page being absent — never silently skipped.
      if (!ref) throw new Error(`unexpected page in response: "${page.title}"`)

      const wikitext = page.revisions?.[0]?.slots?.main?.content
      if (page.missing || wikitext === undefined) {
        absent.push(ref.title)
        continue
      }

      guides.push({
        title: page.title,
        id: ref.id,
        revisionId: page.revisions![0].revid,
        wikitext,
      })
    }

    console.log(
      `  fetched ${Math.min(i + BATCH_SIZE, titles.length)}/${titles.length} pages`,
    )
  }

  return { fetchedAt: Date.now(), guides, absent }
}

async function readCache(): Promise<GuideCache | null> {
  try {
    return JSON.parse(
      await readFile(`${cacheDir}/guides.json`, 'utf8'),
    ) as GuideCache
  } catch {
    return null
  }
}

/* --------------------------------------------------------- stage 2: parse */

/** A `/Quick guide` that only points back at the quest page has no guide. */
function isRedirect(wikitext: string): boolean {
  return /^\s*#redirect\b/i.test(wikitext)
}

/**
 * Drops the markup that only applies when the page is transcluded elsewhere.
 *
 * The ten Recipe for Disaster subquests are written to be pulled into the
 * parent's full guide, so every heading is padded to one level deeper *when
 * included*: `<includeonly>==</includeonly>==Walkthrough==<includeonly>==</includeonly>`.
 * Read literally that is a level-2 heading with stray `==` either side, and the
 * anchored match below misses all ten — which is what silently cost us the
 * whole of Recipe for Disaster on the first run.
 *
 * `<onlyinclude>` and `<noinclude>` only bracket content, so their tags go and
 * their bodies stay; `plainText` would strip the tags later anyway, but by then
 * the headings have already been parsed.
 */
function stripTransclusionMarkup(wikitext: string): string {
  return wikitext
    .replace(/<includeonly>[\s\S]*?<\/includeonly>/gi, '')
    .replace(/<\/?(?:onlyinclude|noinclude)>/gi, '')
}

/**
 * The walkthrough, sliced out of the page.
 *
 * `==Details==` and `==Rewards==` are transclusions of the quest page we
 * already parse, and `==Required for completing==` is the dependency graph we
 * already compute — all three would be duplicate data shipped twice. Only the
 * walkthrough is new.
 */
function walkthrough(source: string): string | null {
  const wikitext = stripTransclusionMarkup(source)
  const heading = /^==\s*Walkthrough\s*==\s*$/m.exec(wikitext)
  if (!heading) return null

  const from = heading.index + heading[0].length
  const next = /^==[^=][\s\S]*?==\s*$/m.exec(wikitext.slice(from))
  return next ? wikitext.slice(from, from + next.index) : wikitext.slice(from)
}

/**
 * Markup that carries nothing once the images are gone.
 *
 * `{{Map}}` and `[[File:...]]` are wiki-hosted images we don't ship, and both
 * survive `plainText` as garbage rather than vanishing: a File link's caption
 * is its last pipe-separated field, so the generic `[[Target|label]]` rule
 * turns one into the bare words "thumb|right|The solved map puzzle." dropped
 * mid-paragraph. Stripped whole, before anything else runs.
 */
function stripMedia(text: string): string {
  let out = dropBalanced(text, /\[\[(?:File|Image):/i, '[[', ']]')
  // Wikitables are laid out in columns we have nowhere to put. Left in, they
  // reduce to their own syntax as prose: `{| class="wikitable" |+ !Emblem !God`.
  out = dropBalanced(out, /\{\|/, '{|', '|}')
  for (const name of ['Map', 'Mapkey', 'Infobox']) {
    for (;;) {
      const match = findTemplate(out, name)
      if (!match) break
      out = out.slice(0, match.start) + out.slice(match.end)
    }
  }
  return out
}

/**
 * Removes every `open`…`close` region starting at `first`, counting nesting.
 *
 * Regex can't do this and the near-misses are worse than useless: a File link's
 * caption routinely contains its own `[[link]]`, so a `[^\]]*` match stops
 * inside the caption and leaves the tail (`.]]`) behind as a sentence of its
 * own. An unterminated region truncates to the end, on the grounds that
 * whatever follows an unclosed image tag was never going to read as prose.
 */
function dropBalanced(
  text: string,
  first: RegExp,
  open: string,
  close: string,
): string {
  let out = text
  for (;;) {
    const start = out.search(first)
    if (start === -1) return out

    let depth = 0
    let end = -1
    for (let i = start; i < out.length - 1; i++) {
      if (out.startsWith(open, i)) {
        depth++
        i++
        continue
      }
      if (out.startsWith(close, i)) {
        depth--
        i++
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    out =
      end === -1 ? out.slice(0, start) : out.slice(0, start) + out.slice(end)
  }
}

/**
 * Template names as written, so the parser can match them literally.
 *
 * Wikitext template names are case-insensitive in their first letter and the
 * wiki's editors use that freely — Ethically Acquired Antiquities writes both
 * `{{checklist|` and `{{chat option|`, and matching only the capitalised form
 * silently dropped that entire quest's walkthrough. Normalised here rather than
 * by making `findTemplate` case-insensitive, which would change what
 * `build-quests` and `build-diaries` match without anyone asking for it.
 */
function normalizeTemplateNames(wikitext: string): string {
  return wikitext
    .replace(/\{\{\s*checklist\s*\|/gi, '{{Checklist|')
    .replace(/\{\{\s*chat option\s*\|/gi, '{{Chat option|')
    .replace(/\{\{\s*needed\s*\|/gi, '{{Needed|')
}

/**
 * Dialogue options, pulled out before the text is flattened.
 *
 * The wiki writes `{{Chat option|2How can I help?|1Yes.}}`, where each
 * parameter is the option's position in the menu followed by what it says.
 * `plainText` strips every template it doesn't know, which would take the
 * options with it — and "talk to Alec Kincade" minus the options is a step you
 * have to work out again at the keyboard, which is the one thing a quick guide
 * exists to prevent.
 *
 * **Exactly one leading digit, never `\d+`.** An OSRS dialogue menu never
 * offers more than five choices, so the second digit is always the start of
 * the answer rather than more of the number — and the answers that begin with
 * one are the puzzle solutions, where getting it wrong is worst. Making
 * History's `{{Chat option|236|18}}` is "pick option 2, say 36" and "pick
 * option 1, say 8"; read greedily it became option 23 saying "6". Same for
 * Icthlarin's Little Helper (`29.` = option 2, answer "9.") and Making
 * History's `112, but what…` (option 1).
 */
function takeChatOptions(line: string): { text: string; chat: string[] } {
  const chat: string[] = []
  let text = line

  for (;;) {
    const match = findTemplate(text, 'Chat option')
    if (!match) break
    for (const part of templateParts(match.body)) {
      const option = /^\s*\|?\s*(\d)\s*(.+)$/s.exec(part)
      if (!option) continue
      const label = plainText(option[2])
      if (label) chat.push(`${option[1]}. ${label}`)
    }
    text = text.slice(0, match.start) + text.slice(match.end)
  }

  return { text, chat }
}

/**
 * One bullet line, once its leading asterisks have been counted off.
 *
 * The trailing-brace strip is for the last bullet of a checklist: the wrapper's
 * closing `}}` sits on the end of it, and `plainText` only removes braces in
 * matched pairs, so without this Cook's Assistant ends on "quest complete!}}".
 */
function parseStep(line: string, depth: number): QuestGuideStep | null {
  const { text: withoutChat, chat } = takeChatOptions(line)
  const text = clean(withoutChat)
  if (!text && !chat.length) return null

  return {
    text,
    ...(depth > 0 ? { depth } : {}),
    ...(chat.length ? { chat } : {}),
  }
}

/**
 * Per-section prose worth keeping, as opposed to markup that reduced to noise.
 *
 * Almost always an "Items required:" line, which exists nowhere else — the
 * quest's own item list is the union for the whole quest, and the point of the
 * per-section one is that you can bank between chapters. `{{Needed|...}}` is
 * the same fact in template form and gets a label, because stripped bare it
 * arrives as an unexplained item name floating above the steps.
 */
function parseNote(block: string): string[] {
  const notes: string[] = []

  // `{{Needed|gear, food|recommended=Xeric's talisman}}` is two facts, and the
  // named parameter has to be split off rather than swept into the first:
  // treated as one string it renders as "Needed: gear, food|recommended=…",
  // which is the template's syntax showing through to the player.
  let rest = block
  for (;;) {
    const match = findTemplate(rest, 'Needed')
    if (!match) break
    const parts = templateParts(match.body)
    for (const part of parts) {
      const named = /^\s*\|?\s*recommended\s*=([\s\S]*)$/i.exec(part)
      const label = named ? 'Recommended' : 'Needed'
      const value = clean(named ? named[1] : part.replace(/^\s*\|/, ''))
      if (value) notes.push(`${label}: ${value}`)
    }
    rest = rest.slice(0, match.start) + rest.slice(match.end)
  }

  const text = clean(rest)
  if (text.length > 2) notes.push(text)

  // Anything still carrying markup lost its meaning somewhere above. A note is
  // supporting prose — dropping one costs a sentence, while showing `{|
  // class="wikitable"` in a walkthrough costs the reader's trust in all of it.
  return notes.filter((note) => !/[{}]|\[\[|\]\]|\|/.test(note))
}

/**
 * Wiki markup to prose, plus the braces our own unwrapping leaves orphaned.
 *
 * Unwrapping `{{Checklist|` without matching its `}}` means every checklist
 * leaves one closing pair somewhere — usually on the last bullet, sometimes
 * mid-line where it silently welds two sentences together ("…highly
 * recommended.}}Note: This is a multi-combat zone"). `plainText` has already
 * removed every *matched* pair by this point, so anything still standing is an
 * orphan by definition and becomes a space rather than being deleted outright.
 */
function clean(text: string): string {
  return (
    plainText(stripMedia(text))
      .replace(/[{}]+/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      // A line left hanging on a preposition lost a live Grand Exchange price:
      // `{{Coins|{{GEP|Egg|1}}}}` is a number we deliberately don't ship, and
      // "Buy from the Grand Exchange for" reads as a truncated app rather than
      // as a fact withheld. Trimmed only with no sentence-ending punctuation
      // after it, so "push the boulder to get around." keeps its preposition.
      .replace(/\s+(?:for|of|about)\s*:?$/i, '')
  )
}

/**
 * A section's body — its bullets as steps, everything else as notes.
 *
 * Bullets are read directly rather than only from inside `{{Checklist}}`,
 * because the template turns out to be a convention rather than a rule: Getting
 * Ahead opens one and never closes it, so its last three chapters are bare
 * bullet lists, and a checklist-only parse dropped that quest entirely. The
 * template is presentational anyway — it draws the tick boxes — so treating it
 * as the thing that *defines* a step was giving the wiki's rendering authority
 * over our data.
 */
function parseBody(body: string): { steps: QuestGuideStep[]; notes: string[] } {
  const steps: QuestGuideStep[] = []
  const notes: string[] = []
  let prose: string[] = []

  const flushProse = () => {
    if (prose.length) notes.push(...parseNote(prose.join('\n')))
    prose = []
  }

  // The wrapper is unwrapped, not matched: an unclosed one has no end to find,
  // and the bullets inside it are the same bullets either way.
  for (const source of body.replace(/\{\{Checklist\|/g, '\n').split('\n')) {
    const line = source.trim()
    if (!line) {
      flushProse()
      continue
    }
    if (line.startsWith('*')) {
      flushProse()
      const depth = (line.match(/^\**/) ?? [''])[0].length - 1
      const step = parseStep(line.replace(/^\*+\s*/, ''), depth)
      if (step) steps.push(step)
      continue
    }
    prose.push(line)
  }
  flushProse()

  return { steps, notes }
}

const HEADING = /^(={3,4})\s*(.+?)\s*\1\s*$/gm

function parseSections(text: string): QuestGuideSection[] {
  const sections: QuestGuideSection[] = []

  // Split on headings first; a heading always closes the section above it, and
  // the text before the first one belongs to an implicit untitled section —
  // which is the whole of a short quest's guide.
  const boundaries: { title: string | null; depth: number; from: number }[] = [
    { title: null, depth: 0, from: 0 },
  ]
  HEADING.lastIndex = 0
  for (let m = HEADING.exec(text); m; m = HEADING.exec(text)) {
    boundaries.push({
      title: plainText(m[2]),
      depth: m[1].length - 3,
      from: m.index + m[0].length,
    })
  }

  for (const [i, boundary] of boundaries.entries()) {
    const body = text.slice(boundary.from, boundaries[i + 1]?.from ?? undefined)
    // The next section's heading line is still on the end of this slice.
    const trimmed = body.replace(/\n={3,4}[^\n]*$/, '')

    const { steps, notes } = parseBody(trimmed)

    if (steps.length || notes.length) {
      sections.push({
        title: boundary.title,
        ...(boundary.depth > 0 ? { depth: boundary.depth } : {}),
        notes,
        steps,
      })
    }
  }

  return sections
}

function parseGuide(page: CachedGuide, generatedAt: string): QuestGuide | null {
  const body = walkthrough(normalizeTemplateNames(page.wikitext))
  if (!body) return null

  const sections = parseSections(body)
  if (!sections.some((section) => section.steps.length)) return null

  return {
    id: page.id,
    generatedAt,
    sourceUrl: `https://oldschool.runescape.wiki/w/${encodeURIComponent(
      page.title.replace(/ /g, '_'),
    )}`,
    sections,
  }
}

/* -------------------------------------------- stage 3: emit and stay honest */

/**
 * Revision ids the committed guides were built from, written to `src/data`
 * beside the quest lock rather than into `public/` — it is a build input, not
 * something to serve.
 */
interface SourceLock {
  generatedAt: string
  /**
   * Guide page title -> revision id, for **every page that exists** — including
   * the ones that yielded no guide because they redirect to the quest page.
   *
   * Recording those too is what keeps `--check` quiet: omitted, a redirect
   * would read as a brand-new page every single week and the scheduled job
   * would cry wolf until nobody read it. Kept, it reports only when the
   * redirect is actually edited — which is exactly when it might have become a
   * real guide worth picking up.
   */
  revisions: Record<string, number>
  /** Quests with no `/Quick guide` page at all, so `--check` can spot a new one. */
  absent: string[]
}

async function emit(guides: QuestGuide[], cache: GuideCache) {
  await mkdir(outDir, { recursive: true })

  // Remove guides for quests that no longer have one, or that left the dataset.
  // Left behind they would keep being served and keep looking current, since
  // nothing else ever revisits this directory.
  const keep = new Set(guides.map((guide) => `${guide.id}.json`))
  let removed = 0
  for (const name of await readdir(outDir).catch(() => [])) {
    if (name.endsWith('.json') && !keep.has(name)) {
      await rm(`${outDir}/${name}`)
      removed++
    }
  }
  if (removed) console.log(`  removed ${removed} stale guide file(s)`)

  for (const guide of guides) {
    // Indented, because the scheduled drift check opens a PR against these and
    // the argument there is to read the diff rather than the tick. Minified,
    // every guide would be a one-line diff saying nothing.
    await writeFile(
      `${outDir}/${guide.id}.json`,
      `${JSON.stringify(guide, null, 1)}\n`,
    )
  }

  const lock: SourceLock = {
    generatedAt: new Date().toISOString().slice(0, 10),
    revisions: Object.fromEntries(
      [...cache.guides]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((page) => [page.title, page.revisionId]),
    ),
    absent: [...cache.absent].sort(),
  }
  await writeFile(
    `${dataDir}/guides.sources.json`,
    `${JSON.stringify(lock, null, 2)}\n`,
  )
}

/**
 * Compares the committed guides against the live wiki using revision ids only,
 * the same cheap shape as the quest check — five small requests, no page bodies.
 */
async function checkForDrift(): Promise<number> {
  const lock = JSON.parse(
    await readFile(`${dataDir}/guides.sources.json`, 'utf8'),
  ) as SourceLock

  const refs = await questRefs()
  const expected = refs.map((ref) => `${ref.title}${SUBPAGE}`)

  const live = new Map<string, number | null>()
  for (let i = 0; i < expected.length; i += BATCH_SIZE) {
    const body = (await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'ids',
      titles: expected.slice(i, i + BATCH_SIZE).join('|'),
    })) as {
      query?: {
        pages?: {
          title: string
          missing?: boolean
          revisions?: { revid: number }[]
        }[]
      }
    }
    for (const page of body.query?.pages ?? []) {
      live.set(
        page.title,
        page.missing ? null : (page.revisions?.[0]?.revid ?? null),
      )
    }
  }

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const title of expected) {
    const revision = live.get(title) ?? null
    const known = lock.revisions[title]
    if (revision === null) {
      if (known !== undefined) removed.push(title)
      continue
    }
    if (known === undefined) added.push(title)
    else if (known !== revision) changed.push(title)
  }

  console.log(
    `guides: ${added.length} new, ${removed.length} gone, ${changed.length} edited`,
  )
  for (const title of [...added, ...removed, ...changed].slice(0, 20)) {
    console.log(`  ${title}`)
  }

  return added.length + removed.length + changed.length
}

async function main() {
  const refresh = process.argv.includes('--refresh')

  if (process.argv.includes('--check')) {
    process.exitCode = (await checkForDrift()) > 0 ? 1 : 0
    return
  }

  const refs = await questRefs()
  console.log(`${refs.length} quests in the dataset`)

  let cache = refresh ? null : await readCache()
  if (cache) {
    const age = Math.round((Date.now() - cache.fetchedAt) / 60_000)
    console.log(
      `using cached wikitext: ${cache.guides.length} guides, ${age} minute(s) old`,
    )
    console.log('pass --refresh to re-fetch.')
  } else {
    console.log('fetching quick guides from the OSRS Wiki...')
    cache = await fetchAll(refs)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(`${cacheDir}/guides.json`, JSON.stringify(cache))
    console.log(
      `cached ${cache.guides.length} guides to .cache/wiki/guides.json`,
    )
  }

  if (cache.absent.length) {
    console.log(`\nno quick guide page (${cache.absent.length}):`)
    for (const title of cache.absent) console.log(`  ${title}`)
  }

  const generatedAt = new Date().toISOString().slice(0, 10)
  const guides: QuestGuide[] = []
  const redirects: string[] = []
  const unparsed: string[] = []
  for (const page of cache.guides) {
    // A redirect is the wiki saying this quest is short enough not to need a
    // quick guide, which is an answer rather than a failure. Counting it as one
    // would put a permanent floor under the failure count and make the number
    // meaningless.
    if (isRedirect(page.wikitext)) {
      redirects.push(page.title)
      continue
    }
    const guide = parseGuide(page, generatedAt)
    if (guide) guides.push(guide)
    else unparsed.push(page.title)
  }

  if (redirects.length) {
    console.log(`\nredirects to the quest page (${redirects.length}):`)
    for (const title of redirects) console.log(`  ${title}`)
  }

  if (unparsed.length) {
    console.log(`\nno walkthrough parsed (${unparsed.length}):`)
    for (const title of unparsed) console.log(`  ${title}`)
  }

  // Measured against the pages that *claim* to be guides, not against every
  // quest: a quest whose guide page is missing or redirects says nothing about
  // whether the parser still works, and folding those in would let real
  // breakage hide behind a denominator we don't control.
  const parsable = guides.length + unparsed.length
  const coverage = parsable ? guides.length / parsable : 0
  if (coverage < MIN_COVERAGE) {
    throw new Error(
      `only ${guides.length}/${parsable} quick guide pages parsed ` +
        `(${(coverage * 100).toFixed(0)}%, floor ${MIN_COVERAGE * 100}%) — ` +
        `the parse or the page layout has changed`,
    )
  }

  const sections = guides.reduce((n, g) => n + g.sections.length, 0)
  const steps = guides.reduce(
    (n, g) => n + g.sections.reduce((m, s) => m + s.steps.length, 0),
    0,
  )
  const chats = guides.reduce(
    (n, g) =>
      n +
      g.sections.reduce(
        (m, s) => m + s.steps.filter((step) => step.chat).length,
        0,
      ),
    0,
  )
  const notes = guides.reduce(
    (n, g) => n + g.sections.reduce((m, s) => m + s.notes.length, 0),
    0,
  )

  await emit(guides, cache)

  const bytes = guides.reduce((n, g) => n + JSON.stringify(g).length, 0)
  console.log(
    `\nwrote public/guides/ — ${guides.length} guides, ${(bytes / 1024).toFixed(0)} KB minified`,
  )
  console.log(`  sections:    ${sections}`)
  console.log(`  steps:       ${steps} (${chats} with chat options)`)
  console.log(`  section notes: ${notes}`)
  console.log('wrote src/data/guides.sources.json (revision ids, not shipped)')
}

main().catch((error: unknown) => {
  console.error(
    `\nbuild-guides failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(exitCodeFor(error))
})
