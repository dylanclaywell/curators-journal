/**
 * Worker entry.
 *
 * Static assets are served by the platform, not by this code — `run_worker_first`
 * in wrangler.jsonc routes only `/api/*` here. Everything this Worker exists to
 * do is proxy the third-party APIs a browser can't call directly:
 *
 *   - the OSRS hiscores send no CORS headers
 *   - the wiki APIs want a descriptive User-Agent, a forbidden `fetch()` header
 *
 * Handlers live in ./routes and share pure parsing modules with the client from
 * src/lib, so there is one implementation of any given transform.
 */

import { handleHiscores } from './routes/hiscores'
import { handleSync } from './routes/sync'

export interface Env {
  ASSETS: Fetcher
  /**
   * The RuneLite sync store — one row per account hash, see migrations/.
   * Bound as `DB` rather than after the database's name, because a binding is
   * a property on `env` and reads as one at every call site.
   */
  DB: D1Database
}

function notFound(pathname: string): Response {
  return Response.json(
    { ok: false, error: 'not_found', message: `No API route for ${pathname}` },
    { status: 404 },
  )
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      // Defensive: routing shouldn't send anything else here, but if it does,
      // hand it back to the asset server rather than 404ing a real page.
      return env.ASSETS.fetch(request)
    }

    switch (url.pathname) {
      case '/api/hiscores':
        return handleHiscores(request, ctx)
      case '/api/sync':
        return handleSync(request, env)
      default:
        return notFound(url.pathname)
    }
  },
} satisfies ExportedHandler<Env>
