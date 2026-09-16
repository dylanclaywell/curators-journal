/**
 * Bindings available to tests: everything the Worker declares in `Env`, plus
 * the migrations handed across from `vitest.config.ts`.
 *
 * `cloudflare:test` exported a `ProvidedEnv` interface to augment for this;
 * 0.22 deprecated its `env` in favour of the one from `cloudflare:workers`,
 * which is typed as `Cloudflare.Env`, so that is what gets augmented now.
 *
 * This file is for editors only — no tsconfig project includes `test/`, since
 * the worker and node projects would both try to compile it as Worker source.
 * Nothing here is checked by `npm run typecheck`.
 */
import type { D1Migration } from '@cloudflare/vitest-pool-workers'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
