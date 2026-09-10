/**
 * Generates src/data/quests.json from the OSRS Wiki.
 *
 * Why the wiki and not an API: quest requirements have no official source.
 * Jagex's hiscores expose skills and activities only. Of the wiki's three
 * candidate sources, per-quest-page templates won — the wiki has no queryable
 * database extension, and `Module:Questreq/data` runs 21 quests behind and
 * omits exactly the newest ones. ROADMAP.md carries the full reasoning.
 *
 * Built in stages so parsing can be iterated without re-fetching. This file is
 * currently stage 1 of 4: fetch the canonical inventory and every quest page's
 * wikitext into `.cache/wiki/`. Stages 2-4 (parse, cross-check, emit) follow.
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
  console.log('\nstage 1 of 4 complete. Parsing is the next slice.')
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
