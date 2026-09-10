# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StageScape is an OSRS companion PWA. It combines live hiscores with
locally-tracked quest completions to answer "what can I actually start right
now," then builds a dependency-ordered quest queue. Deployed to Cloudflare
Workers with Static Assets; third-party API calls go through the Worker.

## Form factors — measured on device, not assumed

There is no single target size. Three real cases, all served by one codebase:

| Case                         | Shape            | Role                                            |
| ---------------------------- | ---------------- | ----------------------------------------------- |
| Portrait iPad, docked bottom | wide + shallow   | The working side-by-side. OSRS above, us below. |
| Phone, or a narrow window    | 375px wide, tall | Companion-on-a-second-screen                    |
| Full screen                  | large            | What you get when you swap to it                |

**Landscape side-by-side does not work — don't reintroduce it.** OSRS offers
only two window sizes (fullscreen and slightly smaller), and our 375px minimum
window width doesn't fit beside either, so Stage Manager overlaps rather than
tiles. The minimum window _height_ is larger still, which also rules out sitting
in OSRS's letterbox band. Portrait with StageScape docked along the bottom is
the arrangement that works.

Two consequences worth holding onto:

- **The app is swapped to, not watched.** So UI state must survive being
  backgrounded — iOS suspends and eventually kills backgrounded PWAs. Active
  panel, scroll position, current quest and current step all need to persist, or
  swapping back costs enough that the app stops getting used. This is a core
  requirement, not polish.
- **Wide-and-shallow is a first-class layout, not a degraded one.** Vertical
  space is the scarce resource in the docked case, which is the opposite of the
  narrow case. A bottom tab bar that costs 12% of the height there is a bad
  trade; tabs likely belong in a left icon strip when short and wide.

## Commands

```bash
npm run dev            # Vite + HMR, with the Worker running in workerd. /api/* works.
npm run build          # vue-tsc -b && vite build -> dist/client (assets) + dist/stagescape (Worker)
npm run preview        # build, then serve the built output in the Workers runtime
npm run deploy         # build && wrangler deploy
npm run typecheck      # vue-tsc app + tsc tsconfig.worker.json (both must pass)
npm run lint           # eslint --fix   (lint:check = no fix)
npm run format         # prettier --write   (format:check = verify)
npm run build:icons    # rasterize public/icons/icon.svg -> PWA/iOS PNGs
npm run build:icon-set # regenerate src/lib/icons.ts from the vendored packs
```

No test framework is configured.

## Working agreement

- **Committing:** You may commit, but only after explicitly asking "OK to commit?" and
  receiving explicit approval. Never commit without that back-and-forth.
- **Commit messages:** Conventional Commits format (release-please reads them). Body is
  one paragraph at most (omit it when the subject says enough). Do NOT append
  "Co-Authored-By: Claude" or any trailer.
- **Iteration size:** Keep changes small and committable. Get approval, commit, keep moving.
- **Larger changes:** Plan in slices/phases and work through them together — no big-bang diffs.

## The constraint that shapes everything

**OSRS hiscores do not expose quest state.** `index_lite.json` returns skills and
activities only — no quest points, no completions. So there are two kinds of data
and they must not be conflated:

- **Fetched, read-only:** skill levels, XP, activity scores, item prices.
- **User-owned, authoritative, precious:** quest completions. Hand-entered, only
  in IndexedDB, and unrecoverable if lost. This is why export/import exists.

## Architecture

**Panels are the unit of composition** (`src/panels/registry.ts`). One panel is
visible at a time; the tab bar switches them; routes are generated from the
registry. Panels read data only through stores, never fetching directly. This is
deliberate: the eventual plugin system should be "register a panel from a
manifest," not an app rewrite. Keep `PanelDefinition` additive and serializable
— that's why `icon` is a name looked up in the icon set rather than a component.

**Pure lib modules cross the `src/worker/` ↔ `src/` boundary.** Anything that
parses or computes lives in `src/lib/*` with no DOM and no network, so the
Worker and the client share one implementation. `src/worker/` is a different
runtime with different globals: it type-checks separately against
`tsconfig.worker.json` with workers-types, and `tsconfig.app.json` explicitly
excludes it. Both projects include `src/lib`, which is why that directory must
stay free of DOM and Node APIs.

**Everything third-party goes through the Worker.** Not optional:

| Source                          | Why it can't be called from the browser                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `secure.runescape.com` hiscores | No CORS headers                                                          |
| `prices.runescape.wiki`         | Wants a descriptive `User-Agent`; that's a forbidden header in `fetch()` |
| `oldschool.runescape.wiki`      | CORS works with `origin=*`, but same UA etiquette                        |

Route handlers carry a fetch timeout, a response byte cap, and short-TTL Cache
API caching so a remounting panel can't hammer Jagex. Follow the existing shape
when adding one. Register new routes in `src/worker/index.ts`; there is no
file-based routing here (that was a Pages Functions feature).

**Quest data is static and committed.** `src/data/quests.json` is generated by
`scripts/`, not fetched at runtime — the app has to work offline on an iPad that
dropped wifi, and a hand-correctable diffable dataset beats a fragile live wiki
query. Regenerate deliberately; never fetch it at runtime.

## Conventions

- `@/` aliases `src/` (vite + tsconfig). Prefer it in app code; `src/worker/`
  uses relative paths, since it resolves outside the app tsconfig.
- Tailwind v4 (`@tailwindcss/vite`, no config file). Tokens live in `@theme` in
  `src/style.css` — use them, never hardcode hex.

### Art direction: "Quest Journal"

Diegetic. It should look like it belongs to the game, not like a dashboard that
happens to be about it.

- **Parchment ground, oak chrome.** Panel bodies are `parchment`; headers,
  buttons and the tab bar are `brown`.
- **Everything raised or inset is beveled** with the `.bevel` / `.bevel-in`
  (parchment) and `.bevel-oak` / `.bevel-oak-in` (oak) pairs — light on the
  top/left, dark on the bottom/right, as OSRS draws its panels. Don't substitute
  plain borders or shadows; the bevel _is_ the visual system.
- **`.engraved`** puts the hard 1px black shadow under light text on oak. It's
  RuneScape's most recognisable typographic signature. Never use it on
  parchment, where it reads as a printing error.
- **Quest state is red / amber / green** (`todo` / `doing` / `done`), borrowed
  from the in-game journal and tempered for a warm ground. Players already read
  this code fluently; don't invent another one.
- **Type:** `font-display` (IM Fell English) for panel titles and headings only;
  `font-body` (Alegreya Sans, 400/700) for everything else. Both are
  **self-hosted** from `public/fonts` — never add a webfont link. A font request
  that fails offline takes the whole visual identity with it.
- Numbers get `.nums` for tabular figures.
- Radius is 0. Corners are square.

### Touch first

Every case above is a touchscreen operated with a thumb, often one-handed while
the other hand is on the game. This is not a desktop layout that also happens to
work on tablets.

- **Every interactive element gets `.tap`** (44px floor plus `touch-action:
manipulation`). No exceptions, including icon-only buttons.
- **Press states use `:active`, not `:hover`.** Touch has no hover, so a
  hover-only affordance is invisible on the target device. `.pressable` handles
  this. Any hover styling belongs inside `@media (hover: hover)`.
- **Never put information behind hover** — no tooltip as the only source of a
  fact.
- Base font size is 16px. Don't go below it for body text or inputs; iOS zooms
  the viewport when focusing an input under 16px.
- **Panel content uses container queries**, not viewport breakpoints — panels
  should respond to the space they're given, which is what makes one panel work
  in a bottom dock and on a phone. `.rail-shell` is a named container (`rail`):
  `@container rail (max-width: …)`.
- **The shell itself may use the viewport**, because the shell _is_ the window.
  Distinguishing the docked case from full screen needs height or aspect ratio,
  not width — a portrait iPad is ~820px wide whether it's full height or docked
  along the bottom. Don't try to tell them apart by width; it can't be done.
- **375px is the measured floor**, on both Safari and the installed PWA. The
  22rem container rule still earns its place as insurance (an iPhone SE 1st gen
  really is 320pt), but nothing on an iPad will trigger it. The About panel
  reports live window size — measure rather than assume.

### The tab bar degrades in three stages

Panel count and rail width collide here, and the plugin system will make panel
count unbounded. Don't "fix" a cramped tab bar by shrinking targets:

1. Roomy — icon over label.
2. Under 22rem, **or** five or more tabs — icon only. The label moves to
   `aria-label`, so a tab that drops its text keeps its meaning.
3. Genuinely out of room — the strip scrolls horizontally. Tabs shrink to a
   52px floor and then overflow rather than crushing further.

The count threshold is a crude proxy — the real constraint is the longest label,
not how many there are. At the 375px floor a label needs ~76px, so four fit and
six don't. Revisit it against real labels rather than trusting the number.

Open work: in the wide-and-shallow docked case this bar is the wrong shape
entirely, since it spends scarce vertical space to save abundant horizontal
space. A left icon strip is the likely answer there.

### Icons

`src/lib/icons.ts` is **generated** by `scripts/build-icon-set.mjs` — don't edit
it. Add an entry to that script's `ICONS` list and re-run
`npm run build:icon-set`.

- Domain concepts (quests, locks, hourglasses) come from **game-icons.net**
  (CC BY 3.0). Interface chrome (charts, checks, gears) from **Phosphor** (MIT).
- Render through `AppIcon.vue`. Icons carry their own `viewBox` because the two
  packs draw on different grids (512 vs 256) — never assume 24.
- **Pick solid silhouettes, not line drawings.** game-icons are drawn on a 512
  grid for large display; a line-based glyph's strokes are ~18 units, which is
  0.7px at tab-bar size and renders as a grey smudge. `checklist` was exactly
  this mistake and was replaced by `scroll-unfurled`, which carries the same
  meaning as a filled shape. Path length is a decent proxy — under ~600 chars
  on the 512 grid usually means strokes, not mass. Always check a new glyph at
  20px before adopting it.
- **Skill icons are Jagex's own**, fetched at build time into the gitignored
  `public/skill-icons/` by `scripts/build-icon-set.mjs`'s sibling
  `fetch-skill-icons.mjs`. Rendered as `<img>` with `image-rendering: pixelated`
  (they are 23–25px pixel art; smooth downscaling ruins them). Read NOTICE.md
  before adding any further Jagex asset.

## Licensing

- Jagex's Fan Content Policy §8.1 requires this exact notice in a prominent
  place. It ships in the README and the app's About panel:
  "Created using intellectual property belonging to Jagex Limited under the
  terms of Jagex's Fan Content Policy. This content is not endorsed by or
  affiliated with Jagex."
- §2.4 carves trademarks out of the policy entirely: **never use the Jagex or
  RuneScape logos**, or anything implying endorsement.
- §6.1.2 forbids third-party _clients_. StageScape reads public hiscores over
  HTTP and never touches the game client, so it isn't one — keep it that way.
- Embedding Jagex sprites in a third-party tool is **not addressed** by the
  policy — a genuine gap. We use the real skill icons anyway, as a considered
  decision: near-universal fan practice, low practical risk for a personal
  non-commercial tool carrying the §8.1 notice. **Full reasoning and its limits
  are in NOTICE.md — read it before adding another Jagex asset or before
  monetising anything.**
- Jagex assets are **never committed**. `public/skill-icons/` is gitignored and
  repopulated at build time, so the repo redistributes nothing.
- Distributing fan content under the policy grants Jagex a broad, irrevocable,
  sub-licensable licence to it. Known and accepted.
- Fonts are OFL; game-icons is CC BY 3.0 (attribution required); Phosphor is
  MIT. All third-party attribution lives in **NOTICE.md**, kept separate from
  any licence covering our own code.

## Deploy notes

**Cloudflare Workers with Static Assets**, not Pages. Pages is Cloudflare's
legacy path for new projects; gotorecipe stays on it because it's already
deployed, but don't copy that shape here.

`wrangler.jsonc` is the input config. Two things about it are easy to get wrong:

- **Never set `assets.directory`.** `@cloudflare/vite-plugin` generates
  `dist/stagescape/wrangler.json` at build time and populates that field from
  the client build output. Setting it by hand fights the plugin.
- `assets.not_found_handling: "single-page-application"` is what makes deep
  links work. Without it `/quests`, `/stats` and `/about` 404 on a cold load —
  which is exactly how a home-screen PWA launches. A Pages deploy needs a
  `public/_redirects` file for this; Workers does not.

`assets.run_worker_first: ["/api/*"]` means the Worker is invoked **only** for
`/api/*`. Browser navigations are served straight from assets without waking it,
which is both correct here and cheaper. Build output splits: `dist/client` for
assets, `dist/stagescape` for the Worker.

Deploys run through Workers Builds (git-connected) on push to `main`, or
manually with `npm run deploy`.

Safari evicts IndexedDB for non-installed sites after ~7 days idle. Installing to
the home screen is the supported path, and export/import is the safety net.
