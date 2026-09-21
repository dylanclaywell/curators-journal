import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cloudflare } from '@cloudflare/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    cloudflare(),
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: "Curator's Journal",
        short_name: 'Curator',
        description:
          'An OSRS quest journal — what you can start right now, and the order to do the rest in.',
        theme_color: '#3E2F1C',
        background_color: '#241C12',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        /*
         * The quick guides are static JSON but deliberately *not* precached.
         *
         * There are 204 of them and ~870 KB all told — more than `quests.json`
         * and `diaries.json` combined, which are already most of the ~1.1 MB
         * install. Precaching them would roughly double what every install
         * downloads, to ship a player 204 walkthroughs they will read one quest
         * at a time. They are fetched on open and kept by the runtime rule
         * below, so the offline case that actually matters — wifi dropping
         * during a quest you already have open — still works.
         *
         * Without this they would be swept up by the `json` in the pattern
         * above, silently and with no warning anywhere.
         */
        /*
         * `boss-detail/**` is here for the same reason as the guides: 147
         * files of drop tables and fight prose, ~566 KB, read one boss at a
         * time. Both directories must stay listed — this is one array, so
         * adding a directory to `public/` and forgetting it here is silent.
         *
         * The directory is **not** `bosses/`, and that is load-bearing:
         * `/bosses/:id` is the detail *route*. A runtime rule matching
         * `/bosses/` would intercept navigations to it, and the navigation
         * fallback would fight the data fetches. Keep app routes and asset
         * paths in separate namespaces.
         */
        globIgnores: ['guides/**', 'boss-detail/**'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            /*
             * Stale-while-revalidate, not cache-first: a guide's content is
             * only ever replaced by a deploy, so serving the cached copy
             * immediately is always right, and the background refresh is what
             * stops a guide read once from being frozen at that version
             * forever.
             */
            urlPattern: ({ url }) => url.pathname.startsWith('/guides/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'quest-guides',
              // Comfortably above the 204 that exist, so opening every quest in
              // the game never starts evicting guides the player is using.
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // Drop tables, on the same terms as the guides above: replaced
            // only by a deploy, so the cached copy is always right to serve
            // and the background refresh stops it freezing at one version.
            urlPattern: ({ url }) => url.pathname.startsWith('/boss-detail/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'boss-detail',
              // Above the 123 that exist, with room for the list to grow —
              // opening every boss in the game shouldn't start evicting.
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // Stats should show *something* instantly and survive going
            // offline mid-session, so serve the cached copy on failure.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/hiscores'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hiscores',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
