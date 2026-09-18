/**
 * Shared OSRS Wiki plumbing for the dataset generators.
 *
 * Extracted from `build-quests.ts` when `build-diaries.ts` needed the same
 * fetch, retry, batching and template parsing. Nothing here knows what a quest
 * or a diary is — anything domain-shaped belongs in the generator that owns it.
 *
 * This is build-time code: it runs in Node, not in the Worker and not in the
 * browser, so it sits outside `src/lib` and its no-Node rule rather than
 * inside it.
 */

export const API = 'https://oldschool.runescape.wiki/api.php'

/** The wiki asks API consumers to identify themselves. */
export const USER_AGENT =
  'CuratorsJournal/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/curators-journal)'

const headers = { 'user-agent': USER_AGENT }

/** Titles per wikitext request. 50 is the API's limit for unauthenticated use. */
export const BATCH_SIZE = 50

const REQUEST_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3

/**
 * The wiki could not be reached, as distinct from it answering something we
 * couldn't use.
 *
 * The distinction exists for the scheduled drift check: "the wiki is down"
 * carries no information and should pass quietly until next week, while "the
 * dataset is stale" or "the parser broke" are findings that want a human. A
 * single exit code for all three trains everyone to ignore the job.
 *
 * Thrown only when retries are exhausted against a transport failure, a 429 or
 * a 5xx. A 4xx is a bug in our request and stays an ordinary Error.
 */
export class WikiUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WikiUnreachableError'
  }
}

export async function api(params: Record<string, string>): Promise<unknown> {
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
        const message = `wiki API returned ${response.status} for ${params.list ?? params.prop}`
        throw retryable ? new WikiUnreachableError(message) : new Error(message)
      }

      const retryAfter = Number(response.headers.get('retry-after'))
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : attempt * 1000
      console.warn(`  ${response.status} from the wiki, retrying in ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        // The errors thrown deliberately above already carry the right type;
        // what's left to classify is the transport.
        if (!isTransportFailure(error)) throw error
        const reason = error instanceof Error ? error.message : String(error)
        throw new WikiUnreachableError(`could not reach the wiki: ${reason}`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`  request failed (${reason}), retrying`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
  throw new Error('unreachable')
}

/**
 * The exit codes both generators use, and the scheduled drift check reads.
 *
 *   0  the committed dataset matches the wiki, or a generation succeeded
 *   1  a finding that wants a human — stale data, or a parse that failed
 *   2  the wiki could not be reached, which is not a finding at all
 *
 * Two is the one that earns its keep. A volunteer-run wiki being down on a
 * Thursday says nothing about our data, and a job that goes red for it is a
 * job people stop reading.
 */
export const EXIT_OK = 0
export const EXIT_FINDING = 1
export const EXIT_UNREACHABLE = 2

/**
 * Whether an error means we never got an answer.
 *
 * `fetch` rejects with a TypeError when it cannot connect, and
 * `AbortSignal.timeout` rejects with a TimeoutError. Matched by name rather
 * than by constructor because these cross a runtime boundary, where
 * `instanceof DOMException` is not dependable.
 *
 * One predicate, used both to wrap inside `api` and to classify afterwards —
 * the two disagreed when the logic was written twice, and a transport failure
 * that reached `exitCodeFor` without passing through `api` was reported as a
 * finding.
 */
function isTransportFailure(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  return (
    error instanceof TypeError ||
    name === 'TimeoutError' ||
    name === 'AbortError'
  )
}

export function exitCodeFor(error: unknown): number {
  return error instanceof WikiUnreachableError || isTransportFailure(error)
    ? EXIT_UNREACHABLE
    : EXIT_FINDING
}

/** Every mainspace page embedding a template, following continuations. */
export async function pagesEmbedding(template: string): Promise<string[]> {
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
export async function fetchWikitext(
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
      // silently drop an entry from the dataset.
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

/**
 * Extracts a template's raw body by brace matching from its opening tag.
 *
 * Deliberately not a regex: requirement blocks nest templates and links
 * several deep, and a lazy `(.*?)` stops at the first inner `}}`, silently
 * truncating the requirements.
 */
export function templateBody(text: string, name: string): string | null {
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
export function templateParams(body: string | null): Record<string, string> {
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
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Strips wiki markup so a note reads as plain prose in the UI. */
export function plainText(wikitext: string): string {
  let text = wikitext
    .replace(/<!--[\s\S]*?-->/g, '') // editor notes, e.g. "DO NOT ADD 30 FIREMAKING"
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>([\s\S]*?)<\/ref>/g, ' ($1)') // keep the caveat, drop the markup
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1') // [[Target|label]] -> label
    .replace(/\[\[([^\]]*)\]\]/g, '$1') // [[Target]] -> Target
    // {{SCP|Agility|62}} -> Agility 62. The number needs `[\d,]` rather than
    // just `\d`: skill *requirements* never exceed 99 and never carry a comma,
    // but a reward's XP amount does ({{SCP|Smithing|80,000}}) — `\d+` alone
    // would stop at "80" and hand rewards a number 1000x too small.
    .replace(/\{\{SCP\|([^|}]+)\|([\d,]+)[^}]*\}\}/gi, '$1 $2')
    // {{Fairycode|dks}} -> DKS. The code is the point of the sentence it sits
    // in ("travel to fairy ring code DKS"), so dropping it with the other
    // templates leaves an instruction with its instruction removed.
    .replace(/\{\{Fairycode\|([^|}]+)\}\}/gi, (_, code: string) =>
      code.toUpperCase(),
    )
    // {{RuneReq|Fire=5|Cosmic=1}} -> 5 Fire, 1 Cosmic. Otherwise "means to
    // cast Varrock Teleport ()" ships with empty parentheses where the runes
    // should be.
    .replace(/\{\{RuneReq\|([^{}]*)\}\}/gi, (_, body: string) =>
      body
        .split('|')
        .map((p) => p.split('='))
        .filter(([rune, n]) => rune && n)
        .map(([rune, n]) => `${n.trim()} ${rune.trim()}`)
        .join(', '),
    )

  /*
   * Innermost-first, to a fixed point. A single pass of a non-nesting pattern
   * strips `{{GEPT|Battlestaff|15}}` out of
   * `{{NoCoins|{{GEPT|Battlestaff|15}}-105000}}` and leaves the outer braces
   * behind as literal text — which is how `{{#vardefine:` and `{{NoCoins|`
   * ended up rendered to the player.
   */
  for (let pass = 0; pass < 10; pass++) {
    const next = text.replace(/\{\{[^{}]*\}\}/g, '')
    if (next === text) break
    text = next
  }

  return (
    text
      .replace(/'''?/g, '')
      .replace(/<[^>]+>/g, '')
      // Punctuation orphaned by a stripped template: "Teleport ()" and
      // "the city ," read as typos rather than as missing data.
      .replace(/\(\s*\)/g, '')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
