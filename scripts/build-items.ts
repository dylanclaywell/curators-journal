/**
 * Generates src/data/items.json from the wiki's Grand Exchange item mapping.
 *
 * The one generator in this repo with no parser worth the name.
 * `prices.runescape.wiki/api/v1/osrs/mapping` is a genuine structured dataset —
 * 4662 entries carrying id, name, examine, members, alchemy values, buy limit
 * and shop value — so there is no wikitext, no `{{Infobox Item}}`, and nothing
 * to get subtly wrong. What this script does instead is *choose what to keep*,
 * and that choice is the whole design.
 *
 * **It is trimmed to the items our drop tables name, and that was measured.**
 * The full mapping is 705 KB (117 KB gzipped) with the icon field dropped,
 * which would make it the app's second-largest asset behind quests.json. The
 * 657 items the drop tables actually reference are 97 KB (19 KB gzipped) —
 * about the size of bosses.json. Nothing in the app can reach the other 4005:
 * there is no item search and no route to one. CLAUDE.md asks that a further
 * large asset be weighed rather than added, so it was, and this is the answer.
 *
 * The cost is stated plainly because it will come due: an item search over
 * everything (ROADMAP.md, 8e) cannot be built on this file. Widening the trim
 * is one edit to `referencedNames` plus a re-measure — but it is a decision
 * about 600 KB, not a detail.
 *
 * **The join is by name and the names are unique**, which is the fact that
 * makes this safe: all 4662 mapping names are distinct once normalized, so no
 * drop row can be handed the wrong item's id. That is asserted below rather
 * than assumed, because it is someone else's dataset and it is one duplicate
 * away from attaching a plausible price to the wrong item.
 *
 * Depends on `public/boss-detail/` existing, so it runs after `build-bosses`.
 *
 *   npm run build:items            # fetch and write
 *   npm run build:items -- --check # is the committed dataset stale?
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { normalizeItemName } from '../src/lib/items.ts'
import type { Item, ItemDataset } from '../src/lib/items.ts'
import type { BossDetail } from '../src/lib/types.ts'

import { exitCodeFor, WikiUnreachableError } from './lib/wiki.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataDir = `${root}src/data`
const detailDir = `${root}public/boss-detail`

const MAPPING = 'https://prices.runescape.wiki/api/v1/osrs/mapping'

/** The wiki asks API consumers to identify themselves. */
const USER_AGENT =
  'CuratorsJournal/0.1 (OSRS quest companion; +https://github.com/dylanclaywell/curators-journal)'

/** The endpoint's own row shape. Everything but `id` and `name` may be absent. */
interface MappingEntry {
  id?: number
  name?: string
  examine?: string
  members?: boolean
  highalch?: number
  lowalch?: number
  limit?: number
  value?: number
}

/* ------------------------------------------------------------------ fetch */

async function fetchMapping(): Promise<MappingEntry[]> {
  let response: Response
  try {
    response = await fetch(MAPPING, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new WikiUnreachableError(
      `could not reach the price service: ${reason}`,
    )
  }

  if (!response.ok) {
    const message = `the price service returned ${response.status}`
    // Same contract as the wiki: unreachable is not a finding.
    if (response.status === 429 || response.status >= 500)
      throw new WikiUnreachableError(message)
    throw new Error(message)
  }

  const body: unknown = await response.json()
  if (!Array.isArray(body) || !body.length)
    throw new Error('the mapping endpoint did not return a non-empty array')
  return body as MappingEntry[]
}

/* ------------------------------------------------------------------- trim */

/**
 * Every distinct item name our drop tables mention.
 *
 * Read from `public/boss-detail/` rather than from a list here: the drop tables
 * are the only consumer, so deriving the trim from them means a boss added in a
 * later regeneration brings its items with it and nobody has to remember.
 */
async function referencedNames(): Promise<Set<string>> {
  const files = (await readdir(detailDir)).filter((f) => f.endsWith('.json'))
  if (!files.length) {
    throw new Error(
      `no boss detail in ${detailDir} — run build:bosses first, since the ` +
        'item trim is derived from the drop tables',
    )
  }

  const names = new Set<string>()
  for (const file of files) {
    const detail = JSON.parse(
      await readFile(`${detailDir}/${file}`, 'utf8'),
    ) as BossDetail
    for (const table of detail.tables) {
      for (const drop of table.drops) names.add(drop.name)
    }
  }
  return names
}

/**
 * Indexes the mapping by normalized name, failing on a duplicate.
 *
 * Loud rather than last-one-wins: two items sharing a name means every drop row
 * naming it silently gets whichever the endpoint listed later. All 4662 names
 * are distinct today, so this firing means the upstream changed and the join
 * needs a human, not a tiebreak rule invented here.
 */
function indexByName(mapping: MappingEntry[]): Map<string, MappingEntry> {
  const index = new Map<string, MappingEntry>()
  for (const entry of mapping) {
    if (typeof entry.id !== 'number' || typeof entry.name !== 'string') {
      throw new Error(
        `a mapping entry has no id or no name: ${JSON.stringify(entry).slice(0, 120)}`,
      )
    }
    const key = normalizeItemName(entry.name)
    const existing = index.get(key)
    if (existing) {
      throw new Error(
        `the mapping has two items named "${entry.name}" (${existing.id} and ` +
          `${entry.id}). The name join is no longer unique — decide which one a ` +
          'drop row means before regenerating.',
      )
    }
    index.set(key, entry)
  }
  return index
}

/** The endpoint omits a field rather than nulling it; the dataset does the reverse. */
const orNull = (value: number | undefined): number | null => value ?? null

function toItem(entry: MappingEntry): Item {
  return {
    id: entry.id!,
    name: entry.name!,
    examine: entry.examine ?? '',
    members: entry.members ?? false,
    highalch: orNull(entry.highalch),
    lowalch: orNull(entry.lowalch),
    limit: orNull(entry.limit),
    value: orNull(entry.value),
  }
}

async function build(): Promise<{
  dataset: ItemDataset
  names: number
  unmatched: string[]
}> {
  console.log('reading the item mapping')
  const mapping = await fetchMapping()
  console.log(`  ${mapping.length} items`)

  const index = indexByName(mapping)

  console.log('reading the names our drop tables use')
  const names = await referencedNames()
  console.log(`  ${names.size} distinct names`)

  const kept = new Map<number, Item>()
  const unmatched: string[] = []
  for (const name of names) {
    const entry = index.get(normalizeItemName(name))
    if (!entry) {
      unmatched.push(name)
      continue
    }
    kept.set(entry.id!, toItem(entry))
  }

  const items = [...kept.values()].sort((a, b) => a.id - b.id)

  return {
    dataset: {
      generatedAt: new Date().toISOString().slice(0, 10),
      sources: [`${MAPPING} (Grand Exchange item mapping)`],
      omitted: mapping.length - items.length,
      items,
    },
    names: names.size,
    unmatched,
  }
}

/* ----------------------------------------------------------------- output */

/** Everything but `generatedAt`, which moves on every run and means nothing. */
const comparable = (dataset: ItemDataset): string =>
  JSON.stringify({
    omitted: dataset.omitted,
    sources: dataset.sources,
    items: dataset.items,
  })

async function readCommitted(): Promise<ItemDataset | null> {
  try {
    return JSON.parse(
      await readFile(`${dataDir}/items.json`, 'utf8'),
    ) as ItemDataset
  } catch {
    return null
  }
}

/**
 * Drift, by rebuilding and comparing.
 *
 * The other generators diff revision ids, because a wiki page has one. This
 * endpoint has no version of any kind, so the only honest question is whether
 * regenerating would change the file — which is also a stronger test, since it
 * catches a changed *value* and not merely a changed source.
 */
async function checkForDrift(): Promise<number> {
  const committed = await readCommitted()
  if (!committed) {
    console.log('src/data/items.json does not exist yet')
    return 1
  }

  const { dataset } = await build()

  console.log(`generated: ${committed.generatedAt}`)
  console.log(`items: ${committed.items.length}`)

  if (comparable(dataset) === comparable(committed)) {
    console.log('the dataset matches the item mapping')
    return 0
  }

  const before = new Map(committed.items.map((i) => [i.id, i]))
  const after = new Map(dataset.items.map((i) => [i.id, i]))
  const added = [...after.keys()].filter((id) => !before.has(id))
  const gone = [...before.keys()].filter((id) => !after.has(id))
  const changed = [...after].filter(
    ([id, item]) =>
      before.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(item),
  )

  console.log(
    `changed: ${added.length} added, ${gone.length} gone, ${changed.length} edited`,
  )
  for (const id of added.slice(0, 10)) console.log(`  + ${after.get(id)!.name}`)
  for (const id of gone.slice(0, 10)) console.log(`  - ${before.get(id)!.name}`)
  for (const [, item] of changed.slice(0, 10)) console.log(`  ~ ${item.name}`)
  console.log('\nthe dataset is behind the item mapping. Regenerate with:')
  console.log('  npm run build:items')
  return 1
}

/* ------------------------------------------------------------------ main */

async function main() {
  // `--refresh` is accepted and ignored: `check-dataset-drift.ts` passes it to
  // every generator, and this one has no page cache to bypass — it is a single
  // request and always fetches.
  if (process.argv.includes('--check')) {
    process.exitCode = await checkForDrift()
    return
  }

  const { dataset, names, unmatched } = await build()

  await writeFile(
    `${dataDir}/items.json`,
    JSON.stringify(dataset, null, 2) + '\n',
  )

  console.log(
    `\nwrote ${dataset.items.length} items (${dataset.omitted} omitted)`,
  )
  /*
   * Reported, never a defect. These are overwhelmingly untradeable — pets,
   * clue scrolls, quest items, and coins, which the GE does not list — so they
   * have no price by their nature and the UI shows a blank rather than a wrong
   * number. What the count is good for is noticing a jump: if it climbs sharply
   * the name join has broken, not the game.
   */
  console.log(
    `  ${names - unmatched.length}/${names} drop names resolved to an item`,
  )
  console.log(
    `  ${unmatched.length} have no GE entry, e.g. ${unmatched
      .slice(0, 5)
      .join(', ')}`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = exitCodeFor(error)
})
