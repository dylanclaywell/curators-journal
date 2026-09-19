/**
 * The RuneLite sync wire format, and the rules for not trusting it.
 *
 * Pure like `quests.ts` and `backup.ts`: the Worker validates an incoming
 * snapshot with the same code the client validates a fetched one with, so
 * "well formed" has one definition rather than two that drift apart. Nothing
 * here touches the DOM, IndexedDB or the network.
 *
 * Synced data is the third kind of data in this app — see ROADMAP.md Phase 5.
 * Unlike the hiscores it is not read-only chrome, and unlike quest progress it
 * is not the player's own hand-entered record. It arrives over an endpoint
 * that takes no credentials, deliberately, which means any snapshot may have
 * been written by someone else. Two consequences shape this module:
 *
 *   - **Nothing is repaired.** `parseSyncSnapshot` rejects a malformed payload
 *     with a reason rather than salvaging the parts it understands. A partial
 *     snapshot that looks successful is worse than a failure, because it gets
 *     merged and then believed.
 *   - **Merging can only add.** `mergeProgress` takes the higher of the two
 *     states per quest, so a hostile or stale snapshot can over-report
 *     progress and can never erase it. That is what makes the merge toggle a
 *     complete undo, and it is why the player's own progress is safe to leave
 *     untouched on disk while this is switched on.
 */
import type { ProgressMap, QuestProgress } from './quests'

/**
 * Bumped when the shape below changes incompatibly. The Worker stores it
 * alongside the payload so a plugin running an older format is rejected
 * cleanly rather than parsed into something plausible but wrong.
 */
export const SYNC_SCHEMA_VERSION = 1

/**
 * Caps, not guesses at a correct size. The endpoint is unauthenticated, so
 * these are what stop a stranger turning one row into free storage; the
 * dataset is 214 quests with ids up to 48 characters, so both are generous
 * against real data and still bounded.
 */
const MAX_QUEST_ENTRIES = 400
/** The dataset has 48 tiers; this is generous against that and still bounded. */
const MAX_TIER_ENTRIES = 100
const MAX_ID_LENGTH = 64

/** Quest ids derive from wiki titles and are kebab-case throughout. */
const ID_PATTERN = /^[a-z0-9-]+$/

/**
 * RuneLite's `getAccountHash()` is an unsigned long rendered as a decimal
 * string. Requiring digits also rejects `-1`, which is what the client returns
 * when nobody is logged in — the single most likely piece of junk a plugin
 * sends by accident, and one that would otherwise become a shared row every
 * logged-out client writes to.
 */
const ACCOUNT_HASH_PATTERN = /^\d{1,20}$/

const PROGRESS_STATES: ReadonlySet<string> = new Set([
  'todo',
  'doing',
  'done',
] satisfies QuestProgress[])

/**
 * Achievement diary state, at tier granularity and no finer.
 *
 * The game exposes a diary tier as a single done-or-not flag and nothing about
 * the tasks inside it, so this carries exactly that: the tiers that are
 * complete, by our tier id (`ardougne-easy`). Absence means "not reported as
 * done", not "not started" — there is no `doing`, and a type that could say
 * so would be claiming visibility the plugin does not have.
 */
export interface SyncDiaries {
  tiers: string[]
}

/** What the plugin sends. */
export interface SyncSnapshot {
  schemaVersion: typeof SYNC_SCHEMA_VERSION
  accountHash: string
  /**
   * Nested under its own key rather than being the top level of the payload,
   * so diaries or combat achievements could ride the same pipe later without
   * a breaking change. Only non-`todo` entries are expected: `todo` is the
   * absence of an entry, exactly as the quest store persists it.
   */
  quests: Record<string, QuestProgress>
  /**
   * Optional on the wire so a plugin that predates diaries still validates at
   * schema version 1, and always present on a snapshot `parseSyncSnapshot`
   * returns. Only absent on one cached before diaries existed, which is why
   * readers should treat a missing value as "no tiers".
   */
  diaries?: SyncDiaries
}

/** What the API returns: the snapshot, plus when the Worker accepted it. */
export interface StoredSnapshot extends SyncSnapshot {
  /** ISO timestamp, server-assigned. The plugin's clock is not trusted. */
  receivedAt: string
}

export type SyncParseResult =
  { ok: true; snapshot: SyncSnapshot } | { ok: false; error: string }

export type StoredParseResult =
  { ok: true; snapshot: StoredSnapshot } | { ok: false; error: string }

function isQuestProgress(value: unknown): value is QuestProgress {
  return typeof value === 'string' && PROGRESS_STATES.has(value)
}

/**
 * Validates a snapshot as it arrives — from the plugin at the Worker, or from
 * the Worker at the client. Unknown quest ids are *not* checked here: that
 * needs the dataset, which the Worker deliberately doesn't carry, and an id
 * matching no quest is inert anyway since the merge only ever reads ids the
 * dataset already knows. `reconcileSnapshot` drops them client-side, where
 * they are worth reporting as drift rather than treating as an attack.
 */
export function parseSyncSnapshot(raw: unknown): SyncParseResult {
  const fail = (error: string): SyncParseResult => ({ ok: false, error })

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('Snapshot is not an object.')
  }
  const obj = raw as Record<string, unknown>

  if (obj.schemaVersion !== SYNC_SCHEMA_VERSION) {
    return fail(
      `Unsupported sync schema version: ${JSON.stringify(obj.schemaVersion)}.`,
    )
  }

  if (
    typeof obj.accountHash !== 'string' ||
    !ACCOUNT_HASH_PATTERN.test(obj.accountHash)
  ) {
    return fail('Snapshot has a missing or invalid account hash.')
  }

  const quests = obj.quests
  if (typeof quests !== 'object' || quests === null || Array.isArray(quests)) {
    return fail('Snapshot is missing its quest map.')
  }

  const entries = Object.entries(quests as Record<string, unknown>)
  if (entries.length > MAX_QUEST_ENTRIES) {
    return fail(`Snapshot has too many quest entries (${entries.length}).`)
  }

  const progress: Record<string, QuestProgress> = {}
  for (const [id, state] of entries) {
    if (id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) {
      return fail(`Snapshot has an invalid quest id: ${JSON.stringify(id)}.`)
    }
    if (!isQuestProgress(state)) {
      return fail(`Snapshot has an invalid state for "${id}".`)
    }
    // `todo` is the absence of an entry everywhere else, so normalise here
    // rather than carrying a second representation of the default into store.
    if (state !== 'todo') progress[id] = state
  }

  const diaries = parseDiaries(obj.diaries)
  if (typeof diaries === 'string') return fail(diaries)

  return {
    ok: true,
    snapshot: {
      schemaVersion: SYNC_SCHEMA_VERSION,
      accountHash: obj.accountHash,
      quests: progress,
      diaries,
    },
  }
}

/**
 * Validates the optional `diaries` key, returning a message on failure.
 *
 * A missing key is an empty list rather than an error: it is what a plugin
 * that predates diaries sends. A *present* key that is malformed is still
 * refused whole, for the same reason quests are — nothing is salvaged.
 */
function parseDiaries(raw: unknown): SyncDiaries | string {
  if (raw === undefined) return { tiers: [] }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'Snapshot has a malformed diaries entry.'
  }
  const tiers = (raw as Record<string, unknown>).tiers
  if (!Array.isArray(tiers)) return 'Snapshot is missing its diary tier list.'
  if (tiers.length > MAX_TIER_ENTRIES) {
    return `Snapshot has too many diary tiers (${tiers.length}).`
  }

  // A set, so a plugin repeating itself can't inflate the row; a tier is done
  // once however many times it is said.
  const seen = new Set<string>()
  for (const id of tiers) {
    if (
      typeof id !== 'string' ||
      id.length > MAX_ID_LENGTH ||
      !ID_PATTERN.test(id)
    ) {
      return `Snapshot has an invalid diary tier id: ${JSON.stringify(id)}.`
    }
    seen.add(id)
  }
  return { tiers: [...seen] }
}

/**
 * The same, for a snapshot read back from the API, which carries the
 * server-assigned timestamp the plugin's payload doesn't have.
 */
export function parseStoredSnapshot(raw: unknown): StoredParseResult {
  const result = parseSyncSnapshot(raw)
  if (!result.ok) return result

  const receivedAt = (raw as Record<string, unknown>).receivedAt
  if (typeof receivedAt !== 'string' || Number.isNaN(Date.parse(receivedAt))) {
    return { ok: false, error: 'Snapshot has a missing or invalid timestamp.' }
  }

  return { ok: true, snapshot: { ...result.snapshot, receivedAt } }
}

export interface Reconciled {
  /** Entries whose ids exist in the dataset. */
  progress: ProgressMap
  /**
   * Ids the dataset doesn't know. Expected to be empty; a non-empty list means
   * the plugin's quest names and `build:quests` have drifted apart, which is
   * worth surfacing rather than swallowing.
   */
  unknownIds: string[]
}

/** Splits a validated snapshot against the quests this build actually has. */
export function reconcileSnapshot(
  snapshot: SyncSnapshot,
  knownIds: ReadonlySet<string>,
): Reconciled {
  const progress: Record<string, QuestProgress> = {}
  const unknownIds: string[] = []

  for (const [id, state] of Object.entries(snapshot.quests)) {
    if (knownIds.has(id)) progress[id] = state
    else unknownIds.push(id)
  }

  return { progress, unknownIds }
}

export interface ReconciledTiers {
  /** Tier ids the diary dataset knows. */
  tiers: string[]
  /** Ids it doesn't — plugin and `build:diaries` have drifted apart. */
  unknownIds: string[]
}

/**
 * The tier counterpart of `reconcileSnapshot`. Tolerates a snapshot with no
 * `diaries` at all, which is what one cached before diaries existed looks like.
 */
export function reconcileTiers(
  snapshot: SyncSnapshot,
  knownTierIds: ReadonlySet<string>,
): ReconciledTiers {
  const tiers: string[] = []
  const unknownIds: string[] = []

  for (const id of snapshot.diaries?.tiers ?? []) {
    if (knownTierIds.has(id)) tiers.push(id)
    else unknownIds.push(id)
  }

  return { tiers, unknownIds }
}

const RANK: Record<QuestProgress, number> = { todo: 0, doing: 1, done: 2 }

/**
 * Merges synced progress over the player's own, taking the further-along state
 * for each quest.
 *
 * Taking the maximum is the entire safety argument, so it is worth stating
 * plainly: because `todo < doing < done` and neither side can lower the other,
 * a snapshot can only ever move a quest forwards. The player's record is never
 * contradicted, only possibly anticipated — and since this runs on read and
 * nothing here is persisted, switching the merge off restores exactly what was
 * there before.
 */
export function mergeProgress(
  local: ProgressMap,
  synced: ProgressMap,
): ProgressMap {
  const merged: Record<string, QuestProgress> = { ...local }

  for (const [id, state] of Object.entries(synced)) {
    const current = merged[id]
    if (!current || RANK[state] > RANK[current]) merged[id] = state
  }

  return merged
}

/** Why a sync request was refused. Mirrors `HiscoresResult`'s error union. */
export type SyncError =
  | 'invalid_request'
  | 'invalid_snapshot'
  | 'not_found'
  | 'too_large'
  | 'storage_error'

/**
 * What `GET /api/sync` answers with — one shape either way, so the client has
 * a single thing to handle, exactly as the hiscores route does.
 */
export type SyncFetchResult =
  | { ok: true; snapshot: StoredSnapshot }
  | { ok: false; error: SyncError; message: string }

/** What `POST /api/sync` answers with. */
export type SyncWriteResult =
  | { ok: true; receivedAt: string }
  | { ok: false; error: SyncError; message: string }
