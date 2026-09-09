# StageScape

An Old School RuneScape companion that runs as a **docked rail** — a narrow,
always-visible PWA panel sitting beside the game in iPad Stage Manager.

Not a wiki browser and not an overlay. It answers one question well: _what can I
actually do next?_

## What it does

- **Quest queue.** Add a quest and StageScape inserts its unmet prerequisites
  ahead of it in a valid order, surfaces the skill gaps blocking it as their own
  line items, and keeps the next actionable step pinned at the top.
- **Live stats.** Hiscores lookup across every account type, with XP-to-next and
  combat level. Serves the last known values when you go offline.
- **Eligibility, computed.** Locally-tracked completions plus live levels means
  the queue knows what's genuinely startable right now, not just what's next in
  a list.

Quest completions are hand-tracked — the OSRS hiscores don't expose quest state,
so there's nothing to sync from. Ticking a quest cascades to everything it
required, so seeding your history takes a few taps rather than 150.

## Install

Open the site in Safari on iPad and **Share → Add to Home Screen**. Installing
matters for more than the icon: Safari evicts storage for non-installed sites
after about a week idle, and your quest completions live in that storage. There's
a JSON export in settings as a second safety net.

## Development

```bash
npm install
npm run dev      # Vite + HMR, with the Worker running in workerd. /api/* works.
```

One dev server does everything — the Cloudflare Vite plugin runs the Worker in
the real Workers runtime alongside HMR, so `/api/*` behaves in development the
way it will in production.

```bash
npm run typecheck   # app + Worker, both must pass
npm run lint
npm run format
npm run build
```

## How it's built

Vue 3 + TypeScript, Pinia, Tailwind v4, `vite-plugin-pwa`.

Deployed to Cloudflare Workers with Static Assets. A small Worker proxies the
third-party APIs that can't be called from a browser — the hiscores endpoint
sends no CORS headers, and the wiki APIs want a descriptive `User-Agent`, which
browsers refuse to set. Only `/api/*` reaches the Worker; everything else is
served straight from static assets.

Quest requirement data is generated from the OSRS Wiki into a committed
`src/data/quests.json` rather than queried live, so the app stays useful with no
network.

Panels are the unit of composition and routes are generated from a registry,
which is the seam a future plugin system plugs into.

## Design

The look is diegetic — it should read as something that belongs to the game
rather than a dashboard that happens to be about it. Parchment panels, oak
chrome, beveled edges drawn the way OSRS draws them, and the quest journal's own
red / amber / green state colours, which players already read fluently.

Type is IM Fell English for panel titles and Alegreya Sans for everything else,
both self-hosted rather than fetched: a webfont request that fails offline would
take the whole visual identity with it.

Every interactive element clears a 44px touch target and shows its pressed state
on `:active`, not `:hover` — the target device has no hover.

## Data sources

Hiscores and wiki data belong to Jagex and the OSRS Wiki respectively.
StageScape caches politely and identifies itself on every request. It reads
public data only — no credentials, no automation, nothing that touches the game
client, and it is not a third-party client.

It deliberately ships **no Jagex artwork**. Skill and quest iconography uses
fantasy silhouettes from game-icons.net instead, which keeps one coherent icon
system and avoids a question the Fan Content Policy doesn't answer.

## Credits and licences

Created using intellectual property belonging to Jagex Limited under the terms
of Jagex's Fan Content Policy. This content is not endorsed by or affiliated
with Jagex.

- Domain icons — [game-icons.net](https://game-icons.net), CC BY 3.0
  (checklist by Delapouite; hourglass, padlock and open book by Lorc)
- Interface icons — [Phosphor](https://phosphoricons.com), MIT
- Type — IM Fell English and Alegreya Sans, SIL Open Font License
