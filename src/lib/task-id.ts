/**
 * Stable ids for achievement diary tasks, derived from their text.
 *
 * **This is a cross-implementation contract, not an internal detail.** Three
 * things compute or consume these ids, and they must agree exactly:
 *
 *   1. `scripts/build-diaries.ts`, which bakes them into the dataset;
 *   2. the app, which keys hand-entered task completions on them;
 *   3. the RuneLite plugin (Phase 5), which will read a task's text from the
 *      game and hash it to find the same id — no mapping table, provided both
 *      sides normalize and hash identically.
 *
 * That third consumer is why the algorithm below is deliberately plain: it has
 * to be reimplementable in Java from this comment alone, with no library.
 *
 * ## Why content-derived rather than positional
 *
 * A task's position is not stable. The wiki renumbers tasks whenever Jagex
 * inserts one, and with positional ids every completion after the insertion
 * point would shift one place and be **silently attributed to the wrong
 * task** — corruption of hand-entered data that nothing would surface.
 *
 * Content-derived ids fail differently and better: a copyedit to a task's
 * wording orphans that one completion, which disappears rather than landing
 * somewhere false. `build:diaries` reports orphans on every regeneration so
 * the loss is visible rather than silent.
 *
 * ## The algorithm
 *
 * Normalize, then hash, then scope to the tier:
 *
 *   1. Lowercase.
 *   2. Replace every run of characters outside `[a-z0-9]` with one space.
 *   3. Trim.
 *   4. FNV-1a, 32-bit, over the UTF-16 code units of the result.
 *   5. Render as 8 lowercase hex digits, zero-padded.
 *   6. Prefix with the tier id: `ardougne-easy-1f3c9a02`.
 *
 * Step 2 is doing the real work. Wiki prose and in-game text differ in
 * punctuation, capitalisation and stray markup far more often than in words,
 * so reducing to words-and-digits is what lets the plugin's hash land on the
 * dataset's. It will not always: the wiki sometimes rewords a task outright.
 * The plugin is expected to log what it cannot match rather than guess, which
 * makes the mismatch a drift report instead of a silent gap.
 *
 * Scoping to the tier means collisions only matter among the ~19 tasks of one
 * tier, which is why a 32-bit hash is ample. The generator asserts uniqueness
 * anyway rather than trusting that argument.
 */

/** Words and digits only, single-spaced. See the note on step 2 above. */
export function normalizeTaskText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * FNV-1a, 32-bit.
 *
 * `>>> 0` after the multiply keeps the value an unsigned 32-bit integer;
 * without it JavaScript's doubles lose the low bits and the result stops
 * matching any other language's implementation.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash *= 16777619, in 32-bit arithmetic that survives float64.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** The id for one task: `<tierId>-<8 hex digits>`. */
export function taskIdFor(tierId: string, text: string): string {
  const hash = fnv1a32(normalizeTaskText(text))
  return `${tierId}-${hash.toString(16).padStart(8, '0')}`
}
