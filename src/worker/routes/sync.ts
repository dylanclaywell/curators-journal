/**
 * POST /api/sync           — the RuneLite plugin writes a snapshot
 * GET  /api/sync?hash=...  — the client reads one back
 *
 * Unlike `hiscores.ts` this proxies nothing: the data is ours, in D1. Two
 * consequences follow from that, and both invert what the hiscores route does.
 *
 * **Nothing is cached.** The hiscores get a 60s TTL because the upstream is
 * slow, rate-limited and barely changes. Here the whole interaction is "press
 * Sync in RuneLite, press Refresh in the app" — a cached read would show the
 * previous snapshot and read as a bug, not as staleness. D1 reads are cheap
 * and strongly consistent, which is exactly why it was chosen over KV.
 *
 * **The request is the untrusted side.** There is no upstream that might
 * misbehave; there is a POST endpoint that takes no credentials, deliberately
 * (see ROADMAP.md Phase 5). So the caps here guard against the *client*: a
 * body size limit before anything is parsed, `parseSyncSnapshot` before
 * anything is stored, and a primary key that makes a writer replace their own
 * row rather than accumulate rows.
 */
import {
  parseStoredSnapshot,
  parseSyncSnapshot,
  type SyncError,
  type SyncFetchResult,
  type SyncWriteResult,
} from '../../lib/sync'
import { readCapped } from '../http'
import type { Env } from '../index'

/**
 * Matches the `CHECK (length(payload) <= 65536)` on the table, so an oversized
 * body is refused with a clear 413 rather than surfacing as a constraint
 * violation from D1. The validator's entry cap means a legitimate snapshot is
 * an order of magnitude under this.
 */
const MAX_BODY_BYTES = 64 * 1024

/** `getAccountHash()` as a decimal string — the same rule the validator uses. */
const ACCOUNT_HASH_PATTERN = /^\d{1,20}$/

function json(
  result: SyncFetchResult | SyncWriteResult,
  status: number,
): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // See the note above: a cached snapshot defeats the refresh button.
      'cache-control': 'no-store',
    },
  })
}

function fail(error: SyncError, message: string, status: number): Response {
  return json({ ok: false, error, message }, status)
}

interface SnapshotRow {
  schema_version: number
  payload: string
  received_at: string
}

async function readSnapshot(request: Request, env: Env): Promise<Response> {
  const hash = new URL(request.url).searchParams.get('hash') ?? ''
  if (!ACCOUNT_HASH_PATTERN.test(hash)) {
    return fail('invalid_request', 'That is not an account hash.', 400)
  }

  let row: SnapshotRow | null
  try {
    row = await env.DB.prepare(
      'SELECT schema_version, payload, received_at FROM snapshot WHERE account_hash = ?',
    )
      .bind(hash)
      .first<SnapshotRow>()
  } catch {
    return fail('storage_error', 'Could not read the sync store.', 500)
  }

  if (!row) {
    return fail(
      'not_found',
      'Nothing has been synced for that account yet.',
      404,
    )
  }

  // Validated on the way out as well as on the way in. The row was checked
  // when it was written, but a schema change or a hand-edited database would
  // both land here, and the client must never be handed a shape it trusts
  // without anyone having looked at it.
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payload)
  } catch {
    return fail('storage_error', 'The stored snapshot was not JSON.', 500)
  }

  const result = parseStoredSnapshot({
    ...(parsed as Record<string, unknown>),
    accountHash: hash,
    schemaVersion: row.schema_version,
    receivedAt: row.received_at,
  })
  if (!result.ok) {
    return fail('storage_error', `The stored snapshot is unusable.`, 500)
  }

  return json({ ok: true, snapshot: result.snapshot }, 200)
}

async function writeSnapshot(request: Request, env: Env): Promise<Response> {
  const text = await readCapped(request, MAX_BODY_BYTES)
  if (text === null) {
    return fail('too_large', 'That snapshot is too large.', 413)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('invalid_request', 'The request body was not JSON.', 400)
  }

  const result = parseSyncSnapshot(raw)
  if (!result.ok) {
    // The validator's own message, which names the field at fault — this is
    // the plugin's only feedback, and "invalid" alone would be useless to it.
    return fail('invalid_snapshot', result.error, 400)
  }

  // Server-assigned: the plugin's clock is not trusted, and this is what the
  // client shows as "last synced".
  const receivedAt = new Date().toISOString()
  const { accountHash, schemaVersion, quests, diaries } = result.snapshot

  try {
    await env.DB.prepare(
      `INSERT INTO snapshot (account_hash, schema_version, payload, received_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_hash) DO UPDATE SET
         schema_version = excluded.schema_version,
         payload        = excluded.payload,
         received_at    = excluded.received_at`,
    )
      .bind(
        accountHash,
        schemaVersion,
        // The whole snapshot is replaced on every write, so a plugin that
        // sends quests alone leaves the row with no diaries rather than
        // keeping stale ones from an earlier sync.
        JSON.stringify({ quests, diaries }),
        receivedAt,
      )
      .run()
  } catch {
    return fail('storage_error', 'Could not write to the sync store.', 500)
  }

  return json({ ok: true, receivedAt }, 200)
}

export async function handleSync(
  request: Request,
  env: Env,
): Promise<Response> {
  switch (request.method) {
    case 'GET':
      return readSnapshot(request, env)
    case 'POST':
      return writeSnapshot(request, env)
    default:
      return fail('invalid_request', 'Use GET or POST.', 405)
  }
}
