/**
 * Applies the real migrations from `migrations/` to the test database before
 * anything runs, then empties it before each test.
 *
 * Tests and production share one schema definition on purpose. A schema
 * written out again here would drift, and the first thing it would stop
 * catching is the migration that was never applied.
 *
 * The truncation is not belt-and-braces. The pool isolates storage per test
 * _file_ — files run concurrently, each with its own database — but tests
 * inside a file share one, so without this a row written by one test is
 * visible to the next and order starts to matter.
 *
 * https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/
 */
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

beforeEach(async () => {
  // Discovered rather than listed, so a table added by a later migration is
  // reset too. D1 keeps its own bookkeeping in `d1_*` and `_cf_*`; clearing
  // those would drop the record of the migrations just applied.
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'd1_%'
        AND name NOT LIKE '_cf_%'`,
  ).all<{ name: string }>()

  for (const { name } of results) {
    await env.DB.prepare(`DELETE FROM "${name}"`).run()
  }
})
