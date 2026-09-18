# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Curator's Journal is an OSRS companion PWA. It combines live hiscores with
locally-tracked quest completions to answer "what can I actually start right
now," then builds a dependency-ordered quest queue. Deployed to Cloudflare
Workers with Static Assets; third-party API calls go through the Worker.

**Read [ROADMAP.md](ROADMAP.md) before starting work.** It carries what's done,
what's next, the open questions, and the decisions whose reasoning isn't visible
in the code — including why the hiscores come from Jagex rather than Wise Old
Man, and why the cache TTL is the only freshness knob. [NOTICE.md](NOTICE.md)
covers third-party licensing, which is more load-bearing here than usual.

`.memories/` holds checkpoints: a fuller decision log including dead ends,
filed as `<date>/<time>_<slug>.md`. Plain markdown and committed, so read and
grep them directly — `summary:` and `tags:` in the frontmatter are the index.
Write new ones with `/checkpoint`. ROADMAP.md is the summary and wins if they
disagree.

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
in OSRS's letterbox band. Portrait with Curator's Journal docked along the bottom is
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
npm run build          # vue-tsc -b && vite build -> dist/client (assets) + dist/curators_journal (Worker)
npm run preview        # build, then serve the built output in the Workers runtime
npm run deploy         # build && wrangler deploy
npm run typecheck      # vue-tsc app + tsc tsconfig.worker.json (both must pass)
npm run lint           # eslint --fix   (lint:check = no fix)
npm run format         # prettier --write   (format:check = verify)
npm run build:icons    # rasterize public/icons/icon.svg -> PWA/iOS PNGs
npm run build:icon-set # regenerate src/lib/icons.ts from the vendored packs
```

Tests run in **workerd**, not Node — `vitest` with
`@cloudflare/vitest-pool-workers`, configured in `vitest.config.ts`. They
live in `test/` rather than beside the code, because `tsconfig.worker.json`
and `tsconfig.node.json` both include `src/lib` with no exclusions and would
try to compile a colocated test as Worker source. Nothing in `test/` is
covered by `npm run typecheck`.

Three things worth knowing, since examples on the web predate them:

- **`defineWorkersConfig` and the `/config` subpath are gone** as of 0.22,
  replaced by a `cloudflareTest()` Vite plugin used from a normal
  `defineConfig`.
- **Storage is isolated per test _file_, not per test.** Files run concurrently
  and each gets its own storage, but tests inside one file share a database —
  so `test/setup.ts` empties the tables before each test, or the suite quietly
  becomes order-dependent. (`--max-workers=1 --no-isolate` makes files share
  storage instead, for integration tests that want it.)
- **The pool bundles an older workerd than wrangler does**, so it refuses the
  `compatibility_date` in wrangler.jsonc and the test runtime pins its own.
  Raise it when the pool catches up.

## Working agreement

- **Committing:** You may commit, but only after explicitly asking "OK to commit?" and
  receiving explicit approval. Never commit without that back-and-forth. This applies to
  **every** commit — approval for one is not approval for the next, and small follow-up
  fixes during a debugging loop are exactly where this gets forgotten.
- **Pushing:** Ask first, separately. Approval to commit is not approval to push. If a
  push is rejected because the remote moved, say so and ask — don't resolve it and retry.
  (Rebasing local `main` onto `origin/main` to resolve such a divergence is fine.)
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
- **User-owned, authoritative, precious:** quest completions and achievement
  diary tier completions. Hand-entered, only in IndexedDB, and unrecoverable if
  lost. They are separate keyspaces and separate storage keys on purpose —
  `quests:progress` and `diaries:progress` — because one map would let a tier id
  collide with a quest slug, and a collision here marks the wrong thing done
  with no way to notice or undo it. This is why export/import exists
  (slice 4b′, from the Settings panel): `src/lib/backup.ts` builds and validates
  the backup shape. Anything hand-entered that lands in IndexedDB belongs in
  that shape — adding a new one means extending the backup too.

## Architecture

**Panels are the unit of composition** (`src/panels/registry.ts`). One panel is
visible at a time; the tab bar switches them; routes are generated from the
registry. Panels read data only through stores, never fetching directly. This is
deliberate: the eventual plugin system should be "register a panel from a
manifest," not an app rewrite. Keep `PanelDefinition` additive and serializable
— that's why `icon` is a name looked up in the icon set rather than a component.

**A drill-down route carries the panel it was reached from.** Quest detail is
not a registry panel, but it mounts at both `/quests/:id` and `/queue/:id` with
`meta.panelId` naming the origin, and derives its back target, its tab-bar
highlight and its own outgoing links from that. Put this context in the path,
never in a remembered variable: iOS kills backgrounded PWAs, and only the URL
survives the relaunch.

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

**`sync.runescape.wiki` is off limits.** WikiSync is a RuneLite plugin that
publishes a player's quest state, achievement diary tiers, levels and combat
achievements as public JSON by username — it looks like the answer to every
"where does completion state come from" question this project has, and it is
not. The wiki asks third parties not to use it, in as many words: _"Please do
not use the WikiSync API in your own projects […] people who enable the plugin
are choosing to share their game data to improve their experience on the wiki,
rather than arbitrary third-parties."_ ([RuneScape:WikiSync
§Third-party use](https://oldschool.runescape.wiki/w/RuneScape:WikiSync#Third-party_use))
They also say they intend to block outside callers, so this is a dead end on
etiquette **and** on reliability. Don't call it, don't mirror it, don't scrape
it, and don't model our own sync shape on it. Completion state that isn't in
the hiscores gets hand-entered or arrives through our own plugin (Phase 5) —
there is no third route.

Route handlers carry a fetch timeout, a response byte cap, and short-TTL Cache
API caching so a remounting panel can't hammer Jagex. Follow the existing shape
when adding one. Register new routes in `src/worker/index.ts`; there is no
file-based routing here (that was a Pages Functions feature).

**Quest and diary data is static and committed.** `src/data/quests.json` and
`src/data/diaries.json` are generated by `scripts/build-quests.ts` and
`scripts/build-diaries.ts`, not fetched at runtime — the app has to work offline
on an iPad that dropped wifi, and a hand-correctable diffable dataset beats a
fragile live wiki query. Regenerate deliberately with `npm run build:quests` /
`npm run build:diaries` (`-- --check` reports whether the wiki has moved);
never fetch either at runtime.

**Regenerate quests before diaries.** `build-diaries` resolves every diary
prerequisite against `quests.json` and fails loud on one it can't find, so
running it against a stale quest list turns a renamed quest into a failed diary
build.

**Both generators exit 0 / 1 / 2**, and the distinction is load-bearing rather
than decorative: `0` current, `1` a finding that wants a human (stale data, or
a parse that failed), `2` the wiki was unreachable. A volunteer-run wiki being
down says nothing about our data, and collapsing that into the same code as a
real finding is how a scheduled check trains everyone to ignore it. The
classification lives in one predicate in `scripts/lib/wiki.ts` — it was written
twice once, and the two copies disagreed.

**Three bundle invariants, all easy to break by adding one static import:**

- `src/data/quests.json` (~463 KB built, ~129 KB gzipped) must stay out of the
  entry chunk — the quest store imports it dynamically. It roughly tripled when
  4d′ added the items each quest wants, then grew again in 4g for description,
  kills and rewards; it is now the app's largest asset by a
  wide margin, so weigh anything that would grow it again.
- `src/data/diaries.json` (~256 KB built, ~45 KB gzipped) must too, for the
  same reason and by the same mechanism — `useDiariesStore().ensureDataset()`.
  Note that `SettingsView` imports the diaries **store** for export/import
  without pulling the dataset in; that only holds while the store's own import
  stays dynamic.
- localForage must too, which is why stores that persist are only reached from
  lazily-loaded panels, and why `App.vue`'s refresh handler imports its stores
  inside the function.

After `npm run build`, grep the `index-*.js` named in `dist/client/index.html`
for `cooks-assistant`, `ardougne-easy` and `localforage`. All three must be
absent. Together the two datasets are most of the ~1.1 MB precache, so a third
wants weighing rather than adding.

**Anything a panel needs, it gets by calling one `ensure*` on a store.**
`useQuestsStore().ensureReady()` loads the dataset _and_ the levels. The
hiscores store hydrates itself from settings and cache via `ensureLoaded()` —
it did not always, and the bug was that a cold load into the quest panel had no
levels because only `StatsView` ever fetched them. Don't reintroduce a panel
that quietly depends on another panel having mounted first.

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
- **`.pressable` is oak-only; parchment controls get `.pressable-parchment`.**
  The first hard-codes brown tones, so putting it on a parchment control
  repaints it brown under the thumb — which is how the second came to exist.
  Match the press class to the surface, not to the element.
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
  really is 320pt), but nothing on an iPad will trigger it. The Settings panel
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
  place. It ships in the README and the app's Settings panel:
  "Created using intellectual property belonging to Jagex Limited under the
  terms of Jagex's Fan Content Policy. This content is not endorsed by or
  affiliated with Jagex."
- §2.4 carves trademarks out of the policy entirely: **never use the Jagex or
  RuneScape logos**, or anything implying endorsement.
- §6.1.2 forbids third-party _clients_. Curator's Journal reads public hiscores over
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
  our own code licence (**Apache-2.0**, see LICENSE).
- Apache-2.0 was chosen over MIT specifically for §4(d), which requires
  derivative works to carry the NOTICE forward. The repo ships no Jagex assets
  but every **build** does, so the obligation attaches to the fetch script
  rather than to the files in git — NOTICE.md spells this out for forks.

## Deploy notes

**Cloudflare Workers with Static Assets**, not Pages. Pages is Cloudflare's
legacy path for new projects; gotorecipe stays on it because it's already
deployed, but don't copy that shape here.

`wrangler.jsonc` is the input config. Two things about it are easy to get wrong:

- **Never set `assets.directory`.** `@cloudflare/vite-plugin` generates
  `dist/curators_journal/wrangler.json` at build time and populates that field from
  the client build output. Setting it by hand fights the plugin.
- `assets.not_found_handling: "single-page-application"` is what makes deep
  links work. Without it `/quests`, `/stats` and `/about` 404 on a cold load —
  which is exactly how a home-screen PWA launches. A Pages deploy needs a
  `public/_redirects` file for this; Workers does not.

`assets.run_worker_first: ["/api/*"]` means the Worker is invoked **only** for
`/api/*`. Browser navigations are served straight from assets without waking it,
which is both correct here and cheaper. Build output splits: `dist/client` for
assets, `dist/curators_journal` for the Worker.

Deploys run through **GitHub Actions** (`.github/workflows/release.yml`), on
release rather than on every push: the job is gated on release-please's
`release_created`, because the Settings panel advertises `__APP_VERSION__` from
`package.json` and only the release PR bumps it. Or manually with
`npm run deploy`.

**Dataset drift is checked on a schedule, never on a PR**
(`.github/workflows/dataset-drift.yml`, Thursdays — OSRS updates land Wednesday
and the wiki is edited hard for the rest of that day). Wiki drift is
time-driven and has nothing to do with whether someone opened a PR, and a
PR-triggered check would also make every PR depend on a volunteer-run third
party, where CI currently needs nothing but npm.

The workflow is four steps and calls one script — `npm run check:drift`,
`scripts/check-dataset-drift.ts`. The logic lives there rather than in a `run:`
block so that it reads the generators' exit codes against the constants they
are defined with instead of re-encoding them as numbers in YAML, and so that it
is type-checked, linted and runnable by hand. Without `--open-pr` it reports
and writes nothing, which is what makes it safe to run locally.

On drift it regenerates, then runs typecheck and tests **inside the job**,
because GitHub does not trigger workflows from events created by
`GITHUB_TOKEN` — a PR opened by this job would otherwise sit with no checks
unless we handed it a long-lived PAT.

It opens a PR and never writes to `main`, and there is deliberately no
auto-merge: the wiki is world-editable, so this is the one path by which
someone else's edit could reach production. A parser regression looks like a
clean exit code and an obvious diff, which is an argument for reading the diff
rather than the tick. The commit is `chore:`, so merging it does **not** deploy
— the data waits for the next release or a manual run of the Release workflow.

**Workers Builds is not connected.** Every deploy goes through GitHub Actions or
the CLI. It was proposed during the Pages→Workers migration and never set up, so
notes claiming git-connected builds are wrong.

Node comes from `.nvmrc` (22). That is wrangler's floor, not a preference:
wrangler 4.130 and miniflare 5 declare `engines: node >=22`, and that arrived
inside the existing `^4` range — so pinning CI to an older Node breaks the
deploy without anything in the repo changing. Keep local dev on the same
version.

Safari evicts IndexedDB for non-installed sites after ~7 days idle. Installing to
the home screen is the supported path, with export/import from the Settings panel as
the safety net underneath it — see ROADMAP.md slice 4b′.
