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

export interface Env {
  ASSETS: Fetcher
}

function notFound(pathname: string): Response {
  return Response.json(
    { ok: false, error: 'not_found', message: `No API route for ${pathname}` },
    { status: 404 },
  )
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      // Defensive: routing shouldn't send anything else here, but if it does,
      // hand it back to the asset server rather than 404ing a real page.
      return env.ASSETS.fetch(request)
    }

    // Phase 2 registers /api/hiscores here.
    return notFound(url.pathname)
  },
} satisfies ExportedHandler<Env>
