/**
 * Tests run inside workerd, not Node.
 *
 * That costs a little startup and buys two things worth more than it. Worker
 * tests get real bindings — `env.DB` is an actual D1 backed by local SQLite,
 * and `SELF.fetch()` goes through the real handler — so a route test exercises
 * routing, the query and the response together rather than a mock of each.
 *
 * And the pure modules under `src/lib` are *required* to run without DOM or
 * Node APIs, because `tsconfig.worker.json` compiles them for the Worker.
 * Testing them in workerd turns that rule into something the suite enforces
 * rather than something a comment asks for.
 *
 * Tests live in `test/` rather than beside the code because both
 * `tsconfig.worker.json` and `tsconfig.node.json` include `src/lib` with no
 * exclusions, so a colocated test file would have to type-check as Worker
 * source — against `cloudflare:test`, which isn't in either project.
 *
 * Note on the API: `@cloudflare/vitest-pool-workers` 0.22 replaced the old
 * `defineWorkersConfig` wrapper (and its `/config` subpath) with a Vite
 * plugin. Examples written against 0.21 and earlier will not work here.
 */
import { defineConfig } from 'vitest/config'
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'

// Read at config time, in Node, because the pool can't reach the filesystem
// from inside the isolate. They're handed across as a binding below.
const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      // The same wrangler.jsonc production uses, so a binding that exists in
      // tests exists in the deploy — and one that doesn't fails here first.
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // The pool bundles its own workerd (miniflare 5.20260815), older than
        // the one wrangler installs, and it refuses to start against a
        // compatibility date it doesn't recognise — so tests can't use the
        // 2026-09-09 in wrangler.jsonc yet. Raise this to match once the pool
        // ships a newer runtime; until then the two dates differ by a few
        // weeks in which nothing this app relies on changed.
        compatibilityDate: '2026-08-22',
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
})
