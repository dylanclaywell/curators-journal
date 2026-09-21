/**
 * Grand Exchange items: the dataset shape, and the name → item join.
 *
 * Pure, and shared by `scripts/build-items.ts` and the app on purpose. The
 * generator trims the dataset to the item names our drop tables use, and the
 * app looks items up by those same names — so if the two normalized differently,
 * items would be present in the file and unfindable at runtime, or vice versa.
 * One `normalizeItemName`, used by both, is what makes that impossible.
 *
 * Prices are not here: they are live, arrive from `/api/prices`, and are keyed
 * by the ids in this file. See `prices.ts`.
 */

/**
 * One tradeable item, from `prices.runescape.wiki/api/v1/osrs/mapping`.
 *
 * A genuine structured dataset, free, and no wiki scraping — which is why this
 * phase has no parser worth the name. The fields are the endpoint's own.
 *
 * **`icon` is deliberately not carried.** The endpoint publishes one, and it
 * names a Jagex sprite. NOTICE.md's position is that every Jagex asset is a
 * considered decision rather than a default, and a field with no renderer is a
 * temptation carried at the cost of 139 KB. Adding it later is a one-line
 * change to the generator; adding it now would be a licensing decision taken by
 * accident.
 */
export interface Item {
  /** The GE item id. This is the key `/api/prices` answers on. */
  id: number
  name: string
  /** The in-game examine text. Flavour, and the reason item detail is a page. */
  examine: string
  members: boolean
  /**
   * `null` where the endpoint doesn't publish one, which is not the same as
   * zero: 90 of 4662 entries state no alchemy value and 512 state no buy limit.
   * A zero buy limit would read as "you may not buy this at all".
   */
  highalch: number | null
  lowalch: number | null
  /** Units buyable per four hours, the GE's own cap. */
  limit: number | null
  /** The item's shop value, which is not its GE price. */
  value: number | null
}

/** Generated artifact shape for src/data/items.json. */
export interface ItemDataset {
  /** ISO date the dataset was generated, shown in settings. */
  generatedAt: string
  sources: string[]
  /**
   * How many of the endpoint's entries were dropped by the trim.
   *
   * Carried rather than inferred so that "this dataset is a subset" is a fact
   * the file states about itself. A reader who finds an item missing should be
   * able to see that missing items are expected here — see `build-items.ts`
   * for what the subset is and why.
   */
  omitted: number
  items: Item[]
}

/**
 * Item names as a lookup key: trimmed, whitespace-collapsed, lowercased.
 *
 * Case folding is not a guess — it was measured. All 4662 mapping names are
 * distinct under this normalization, so folding costs nothing and buys the
 * drop tables' own capitalization for free.
 */
export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Builds the name → item index.
 *
 * A `Map` built once at load rather than a `byName` object in the dataset: the
 * names are already in the file, and emitting them twice would be ~15 KB of a
 * second copy that a regeneration could leave disagreeing with the first.
 *
 * A duplicate name throws rather than resolving to one of them. Two items
 * sharing a name means every drop row naming it gets one item's price, chosen
 * by file order — a plausible number against the wrong item, which is the
 * failure this whole dataset is shaped to avoid. The generator asserts the same
 * thing, so reaching this at runtime means the file was edited by hand.
 */
export function indexItemsByName(items: readonly Item[]): Map<string, Item> {
  const index = new Map<string, Item>()
  for (const item of items) {
    const key = normalizeItemName(item.name)
    const existing = index.get(key)
    if (existing) {
      throw new Error(
        `two items share the name "${item.name}" (${existing.id} and ${item.id})`,
      )
    }
    index.set(key, item)
  }
  return index
}

/**
 * The item a drop row names, or `null` when there is none.
 *
 * **`null` is an ordinary answer here, not a failure.** 236 of the 893 distinct
 * names in our drop tables have no GE entry at all — pets, clue scrolls, quest
 * items, and coins, none of which are tradeable — so a caller must render this
 * as a fact about the item rather than as a price that hasn't loaded.
 */
export function findItemByName(
  index: ReadonlyMap<string, Item>,
  name: string,
): Item | null {
  return index.get(normalizeItemName(name)) ?? null
}
