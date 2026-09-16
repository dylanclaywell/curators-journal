/**
 * The snapshot table carries two of the Phase 5 abuse caps in its schema
 * rather than in a handler, so they hold even if a later route forgets them.
 * A constraint nobody has watched fail is a constraint nobody knows is there,
 * so these assert the failures rather than the happy path.
 *
 * They also prove the pool's D1 wiring end to end: a real binding, the real
 * migrations from `migrations/`, and the per-test reset in `setup.ts`.
 */
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const insert = (
  hash: string,
  version: unknown,
  payload: string,
  receivedAt = '2026-09-16T12:00:00.000Z',
) =>
  env.DB.prepare(
    'INSERT INTO snapshot (account_hash, schema_version, payload, received_at) VALUES (?, ?, ?, ?)',
  )
    .bind(hash, version, payload, receivedAt)
    .run()

describe('the snapshot table', () => {
  it('stores and reads back a snapshot', async () => {
    await insert('123', 1, '{"cooks-assistant":"done"}')

    const row = await env.DB.prepare(
      'SELECT payload FROM snapshot WHERE account_hash = ?',
    )
      .bind('123')
      .first<{ payload: string }>()

    expect(JSON.parse(row!.payload)).toEqual({ 'cooks-assistant': 'done' })
  })

  it('starts each test with an empty table', async () => {
    // The row written above must not be visible here. Isolation is per test
    // file, not per test, so this is `setup.ts`'s reset doing the work — and
    // this test is what notices if it ever stops running.
    const row = await env.DB.prepare(
      'SELECT count(*) AS n FROM snapshot',
    ).first<{ n: number }>()

    expect(row!.n).toBe(0)
  })

  it('allows only one row per account hash', async () => {
    await insert('123', 1, '{}')
    await expect(insert('123', 1, '{}')).rejects.toThrow(/UNIQUE|PRIMARY/i)
  })

  it('replaces rather than accumulates on upsert', async () => {
    await insert('123', 1, '{"first":true}')
    await env.DB.prepare(
      `INSERT INTO snapshot (account_hash, schema_version, payload, received_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_hash) DO UPDATE SET
         schema_version = excluded.schema_version,
         payload        = excluded.payload,
         received_at    = excluded.received_at`,
    )
      .bind('123', 1, '{"second":true}', '2026-09-16T13:00:00.000Z')
      .run()

    const row = await env.DB.prepare(
      'SELECT count(*) AS n, payload FROM snapshot',
    ).first<{ n: number; payload: string }>()

    expect(row!.n).toBe(1)
    expect(JSON.parse(row!.payload)).toEqual({ second: true })
  })

  it('rejects a payload past the size cap', async () => {
    await expect(insert('123', 1, 'x'.repeat(65537))).rejects.toThrow(/CHECK/i)
  })

  it('rejects a schema version that is not an integer', async () => {
    // STRICT converts losslessly where it can, so '1' is fine and 'one' is not.
    await expect(insert('123', 'one', '{}')).rejects.toThrow(
      /DATATYPE|INTEGER/i,
    )
  })
})
