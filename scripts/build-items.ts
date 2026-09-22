/**
 * Generates src/data/items.json and src/data/item-bosses.json.
 *
 * Two files from two sources: the item facts come from the wiki's Grand
 * Exchange mapping, and the index inverting "which bosses drop this" comes from
 * the drop tables in `public/boss-detail/` that `build-bosses` already wrote.
 * One generator because they share a join — the drop tables name items, the
 * mapping has ids, and `normalizeItemName` is what connects them.
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
 * **The index is one entry per drop row, not per boss**, which is the finding
 * that shaped it: 115 (item, boss) pairs appear more than once and not one is a
 * true duplicate — 92 differ by boss version, 14 by table section, 9 are
 * quantity tiers of the same drop. Collapsing them would invent a rate or throw
 * most of the answer away. See `ItemDropSource`.
 *
 * Depends on `public/boss-detail/` existing, so it runs after `build-bosses`.
 *
 *   npm run build:items            # fetch and write
 *   npm run build:items -- --check # is either file stale?
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { normalizeItemName } from '../src/lib/items.ts'
import type {
  Item,
  ItemBossIndex,
  ItemDataset,
  ItemDropSource,
} from '../src/lib/items.ts'
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
 * Every boss's drop tables, read once and used twice — for the trim below and
 * for the inverted index.
 *
 * `public/boss-detail/` rather than a list here: the drop tables are the only
 * consumer, so deriving both from them means a boss added in a later
 * regeneration brings its items with it and nobody has to remember. Sorted so
 * the index's own order is stable across runs and a regeneration diff shows
 * only what changed.
 */
async function readBossDetail(): Promise<BossDetail[]> {
  const files = (await readdir(detailDir)).filter((f) => f.endsWith('.json'))
  if (!files.length) {
    throw new Error(
      `no boss detail in ${detailDir} — run build:bosses first, since the ` +
        'item trim is derived from the drop tables',
    )
  }

  const details: BossDetail[] = []
  for (const file of files) {
    details.push(
      JSON.parse(await readFile(`${detailDir}/${file}`, 'utf8')) as BossDetail,
    )
  }
  return details.sort((a, b) => a.name.localeCompare(b.name))
}

/** Every distinct item name our drop tables mention. */
function referencedNames(details: BossDetail[]): Set<string> {
  const names = new Set<string>()
  for (const detail of details) {
    for (const table of detail.tables) {
      for (const drop of table.drops) names.add(drop.name)
    }
  }
  return names
}

/**
 * The drop tables inverted: item id -> every row that yields it.
 *
 * **Deliberately not deduplicated to one row per boss.** 115 (item, boss) pairs
 * appear more than once and none is a true duplicate — they differ by boss
 * version, by table section, or by quantity tier. See `ItemDropSource`.
 *
 * `section` is the one field from the source row that is dropped: it is the
 * wiki's grouping *within a boss's page* ("Tertiary", "Weapons and armour"),
 * which carries structure there and none at all on an item page.
 */
function buildIndex(
  details: BossDetail[],
  itemByName: Map<string, MappingEntry>,
): ItemBossIndex {
  const byItem: Record<string, ItemDropSource[]> = {}

  for (const detail of details) {
    for (const table of detail.tables) {
      for (const drop of table.drops) {
        const entry = itemByName.get(normalizeItemName(drop.name))
        if (!entry) continue

        const source: ItemDropSource = { id: detail.id, name: detail.name }
        if (drop.rarity !== null) source.rarity = drop.rarity
        if (drop.quantity !== null) source.quantity = drop.quantity
        if (table.version !== null) source.version = table.version
        if (drop.rolls !== null) source.rolls = drop.rolls

        ;(byItem[String(entry.id)] ??= []).push(source)
      }
    }
  }

  // Item ids ascending, to match items.json and keep the diff readable. The
  // rows within one item stay in the wiki's own table order, which is the only
  // thing distinguishing a boss's quantity tiers from one another.
  const sorted: Record<string, ItemDropSource[]> = {}
  for (const id of Object.keys(byItem).sort((a, b) => Number(a) - Number(b))) {
    sorted[id] = byItem[id]!
  }

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    byItem: sorted,
  }
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
  index: ItemBossIndex
  names: number
  unmatched: string[]
}> {
  console.log('reading the item mapping')
  const mapping = await fetchMapping()
  console.log(`  ${mapping.length} items`)

  const byName = indexByName(mapping)

  console.log('reading the drop tables')
  const details = await readBossDetail()
  const names = referencedNames(details)
  console.log(`  ${details.length} bosses, ${names.size} distinct item names`)

  const kept = new Map<number, Item>()
  const unmatched: string[] = []
  for (const name of names) {
    const entry = byName.get(normalizeItemName(name))
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
    index: buildIndex(details, byName),
    names: names.size,
    unmatched,
  }
}

/* ----------------------------------------------------------------- output */

/** Everything but `generatedAt`, which moves on every run and means nothing. */
const comparable = (dataset: ItemDataset, index: ItemBossIndex): string =>
  JSON.stringify({
    omitted: dataset.omitted,
    sources: dataset.sources,
    items: dataset.items,
    byItem: index.byItem,
  })

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(`${dataDir}/${name}`, 'utf8')) as T
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
  const committed = await readJson<ItemDataset>('items.json')
  const committedIndex = await readJson<ItemBossIndex>('item-bosses.json')
  if (!committed || !committedIndex) {
    console.log('src/data/items.json or item-bosses.json does not exist yet')
    return 1
  }

  const { dataset, index } = await build()

  console.log(`generated: ${committed.generatedAt}`)
  console.log(
    `items: ${committed.items.length}, indexed: ${Object.keys(committedIndex.byItem).length}`,
  )

  if (comparable(dataset, index) === comparable(committed, committedIndex)) {
    console.log('the dataset matches the item mapping and the drop tables')
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
  // Counted separately: the drop tables can move without the mapping moving,
  // and then every item above is identical while the index is stale.
  const reindexed = [...after.keys()].filter(
    (id) =>
      JSON.stringify(committedIndex.byItem[String(id)]) !==
      JSON.stringify(index.byItem[String(id)]),
  )

  console.log(
    `changed: ${added.length} added, ${gone.length} gone, ` +
      `${changed.length} edited, ${reindexed.length} with different drop rows`,
  )
  for (const id of added.slice(0, 10)) console.log(`  + ${after.get(id)!.name}`)
  for (const id of gone.slice(0, 10)) console.log(`  - ${before.get(id)!.name}`)
  for (const [, item] of changed.slice(0, 10)) console.log(`  ~ ${item.name}`)
  for (const id of reindexed.slice(0, 10))
    console.log(`  drops ~ ${after.get(id)?.name ?? id}`)
  console.log('\nthe dataset is behind its sources. Regenerate with:')
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

  const { dataset, index, names, unmatched } = await build()

  await writeFile(
    `${dataDir}/items.json`,
    JSON.stringify(dataset, null, 2) + '\n',
  )
  await writeFile(
    `${dataDir}/item-bosses.json`,
    JSON.stringify(index, null, 2) + '\n',
  )

  const rows = Object.values(index.byItem).reduce((n, v) => n + v.length, 0)
  console.log(
    `\nwrote ${dataset.items.length} items (${dataset.omitted} omitted)`,
  )
  console.log(
    `  ${rows} drop rows indexed across ${Object.keys(index.byItem).length} items`,
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
