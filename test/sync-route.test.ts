/**
 * `/api/sync` end to end: the real router, the real handler, the real D1.
 *
 * The endpoint takes no credentials by design, so most of what matters is what
 * it turns away. Each rejection below is a thing a stranger — or a plugin with
 * a bug — can actually send.
 */
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'

const HASH = '1234567890'

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  accountHash: HASH,
  quests: { 'cooks-assistant': 'done', 'dragon-slayer-i': 'doing' },
  ...overrides,
})

const post = (body: unknown) =>
  SELF.fetch('https://app.test/api/sync', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const get = (hash: string) =>
  SELF.fetch(`https://app.test/api/sync?hash=${encodeURIComponent(hash)}`)

describe('POST /api/sync', () => {
  it('stores a snapshot and reports when it landed', async () => {
    const res = await post(snapshot())
    expect(res.status).toBe(200)

    const body = await res.json<{ ok: boolean; receivedAt: string }>()
    expect(body.ok).toBe(true)
    expect(Number.isNaN(Date.parse(body.receivedAt))).toBe(false)

    const row = await env.DB.prepare(
      'SELECT payload FROM snapshot WHERE account_hash = ?',
    )
      .bind(HASH)
      .first<{ payload: string }>()
    expect(JSON.parse(row!.payload)).toEqual({
      quests: { 'cooks-assistant': 'done', 'dragon-slayer-i': 'doing' },
    })
  })

  it('replaces the previous snapshot rather than adding a row', async () => {
    await post(snapshot())
    await post(snapshot({ quests: { 'cooks-assistant': 'doing' } }))

    const row = await env.DB.prepare(
      'SELECT count(*) AS n, payload FROM snapshot',
    ).first<{ n: number; payload: string }>()

    expect(row!.n).toBe(1)
    expect(JSON.parse(row!.payload).quests).toEqual({
      'cooks-assistant': 'doing',
    })
  })

  it('does not store the timestamp the client sent', async () => {
    await post(snapshot({ receivedAt: '1999-01-01T00:00:00.000Z' }))

    const row = await env.DB.prepare(
      'SELECT received_at FROM snapshot WHERE account_hash = ?',
    )
      .bind(HASH)
      .first<{ received_at: string }>()

    expect(row!.received_at.startsWith('1999')).toBe(false)
  })

  it('rejects a body that is not JSON', async () => {
    const res = await post('not json at all')
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toBe('invalid_request')
  })

  it('rejects a snapshot the validator refuses, and says why', async () => {
    const res = await post(snapshot({ accountHash: '-1' }))
    expect(res.status).toBe(400)

    const body = await res.json<{ error: string; message: string }>()
    expect(body.error).toBe('invalid_snapshot')
    expect(body.message).toMatch(/account hash/i)
  })

  it('rejects a body past the size cap before parsing it', async () => {
    const res = await post('x'.repeat(64 * 1024 + 1))
    expect(res.status).toBe(413)
    expect((await res.json<{ error: string }>()).error).toBe('too_large')
  })

  it('writes nothing when the snapshot is refused', async () => {
    await post(snapshot({ quests: { 'Cooks Assistant': 'done' } }))

    const row = await env.DB.prepare(
      'SELECT count(*) AS n FROM snapshot',
    ).first<{ n: number }>()
    expect(row!.n).toBe(0)
  })
})

describe('GET /api/sync', () => {
  it('reads back what was written', async () => {
    await post(snapshot())
    const res = await get(HASH)
    expect(res.status).toBe(200)

    const body = await res.json<{
      ok: boolean
      snapshot: { accountHash: string; quests: Record<string, string> }
    }>()
    expect(body.ok).toBe(true)
    expect(body.snapshot.accountHash).toBe(HASH)
    expect(body.snapshot.quests).toEqual({
      'cooks-assistant': 'done',
      'dragon-slayer-i': 'doing',
    })
  })

  it('never lets a snapshot be cached', async () => {
    await post(snapshot())
    const res = await get(HASH)
    // A cached read would show the previous sync and read as a bug — the whole
    // loop is "sync in RuneLite, refresh here".
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('404s for an account that has never synced', async () => {
    const res = await get('9999999999')
    expect(res.status).toBe(404)
    expect((await res.json<{ error: string }>()).error).toBe('not_found')
  })

  it.each([
    ['a missing hash', ''],
    ['a logged-out hash', '-1'],
    ['a non-numeric hash', 'abc'],
  ])('rejects %s', async (_label, hash) => {
    const res = await get(hash)
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toBe('invalid_request')
  })

  it('refuses to hand back a stored snapshot it cannot validate', async () => {
    // Only reachable by a schema change or a hand-edited database, but the
    // client must never be given a shape nobody checked.
    await env.DB.prepare(
      'INSERT INTO snapshot (account_hash, schema_version, payload, received_at) VALUES (?, ?, ?, ?)',
    )
      .bind(HASH, 1, '{"quests":{"cooks-assistant":"finished"}}', 'not a date')
      .run()

    const res = await get(HASH)
    expect(res.status).toBe(500)
    expect((await res.json<{ error: string }>()).error).toBe('storage_error')
  })
})

describe('/api/sync method handling', () => {
  it('refuses anything but GET and POST', async () => {
    const res = await SELF.fetch('https://app.test/api/sync', {
      method: 'DELETE',
    })
    expect(res.status).toBe(405)
  })
})
