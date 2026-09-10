# Roadmap and open questions

Where the project stands, what's next, and the decisions whose reasoning isn't
obvious from the code. Written so a session with no prior context can pick up
from here.

Conventions and architecture live in [CLAUDE.md](CLAUDE.md). Third-party
licensing lives in [NOTICE.md](NOTICE.md).

## Status

**0.2.0 is deployed** at <https://stagescape.infinitebit.workers.dev>.

The stats half works end to end: hiscores lookup through the Worker, cached
offline-first, a skills grid that reflows from 320px to docked width. The quest
half — the actual point of the app — is not built yet.

## Phases

| Phase                           | State | Notes                                                                     |
| ------------------------------- | ----- | ------------------------------------------------------------------------- |
| 0 — Scaffold                    | done  | Vue 3 + TS, Tailwind v4, PWA, Workers + Static Assets, CI, release-please |
| 1 — Shell                       | done  | Panel registry, generated routes, tab bar, About panel                    |
| 2 — Hiscores                    | done  | 2a route + parser · 2b store + persistence · 2c skills grid               |
| **3 — Quest dataset**           | next  | See below. The biggest remaining unknown.                                 |
| 4 — Quest engine and queue      | —     | Eligibility resolution, prerequisite expansion, the queue UI              |
| Later — prices panel            | —     | `prices.runescape.wiki`, same Worker-proxy shape                          |
| Later — wide-and-shallow layout | —     | Tabs to a left strip when short and wide; see CLAUDE.md                   |
| Later — plugin manifests        | —     | The panel registry is already the seam                                    |

## Phase 3: the quest dataset

Start with a **spike, not code.** There is no quest API; requirements have to
come from the OSRS Wiki, and there are at least three candidate sources that
differ a lot in how parseable they are:

1. A Cargo table (queryable, if one covers quest requirements)
2. The tabular `Quests/Skill requirements` style pages
3. A Lua module backing the wiki's requirement trees

Find which is most complete and stable before writing a generator.

Then `scripts/build-quests.ts` → a **committed** `src/data/quests.json`, with
validation that every prerequisite id resolves and the graph is acyclic. Static
and committed because the app must work offline and a diffable, hand-correctable
dataset beats a fragile live query. The `Quest` / `QuestDataset` shapes are
already sketched in `src/lib/types.ts`.

Budget for this being messier than the hiscores were. Two precedents: the
hiscores response gained a 24th skill (Sailing) with no announcement, and the
wiki's "freely downloadable" icons turned out not to be licensed to us.

## Open questions

1. **How often do the hiscores actually recompute?** Unmeasured, and it's the
   real ceiling on freshness — polling faster than the source updates buys
   nothing. To measure: while training a skill, refresh repeatedly and watch how
   long until the XP figure moves. The Worker's cache TTL (`CACHE_TTL_SECONDS`)
   and the client's `STALE_AFTER_MS` are both 60s pending that number.
2. **Only the `normal` hiscore module is verified.** The other eight in
   `HISCORE_MODULES` follow Jagex's naming convention but are untested, and a
   wrong module name returns 404 exactly like an unknown player. First thing to
   suspect if an ironman lookup fails.
3. **Never tested docked on the device** since the skills grid landed. The
   layout numbers came from a desktop browser at forced widths.
4. **The automated deploy is unproven.** The first release deployed manually;
   the CI path was fixed afterwards. The next release exercises it, and a
   permissions gap would show as a 403 naming the missing scope.
5. **No `workflow_dispatch` on the deploy job**, so a failed deploy can't be
   retried without cutting a release — which is exactly what happened once.

## Decisions whose reasoning isn't in the code

### Jagex's hiscores, not Wise Old Man

WOM has a documented API, rate limits (20/min, 100 with a key) and history that
Jagex's undocumented endpoint doesn't. It was still rejected as the source of
levels, because **it is snapshot-based**: `GET /players/:username` returns a
stored `latestSnapshot` that can be weeks old, and refreshing it needs a `POST`.

That's disqualifying when quest eligibility is computed _from_ levels. A stale
snapshot means telling you a quest is blocked on a level you already have —
wrong in exactly the place the app claims to be useful, and wrong invisibly.

WOM remains a good candidate **additively** later, for gains over time, records
and name-change handling, which it does well and we don't need yet.

### Freshness and rate limits are one constraint, and the TTL is the knob

Freshness is only obtainable by requesting; requests are capped; so the cap is a
ceiling on achievable freshness. The Worker's cache TTL is the only control.

At 60s with one player that's ~1 upstream request per minute — roughly 7% of a
pessimistic 15/min budget, so **the rate limit is not currently binding.** It
starts binding with multiple accounts: a 50-person clan refreshing once a minute
would blow through any plausible limit, so a group feature changes this analysis.

Jagex publishes no rate limit and reportedly declined to confirm one when asked.
The ~15/min figure is a community estimate, with IP-block risk on bulk requests.

### Skill icons

See [NOTICE.md](NOTICE.md), which covers the licensing position, its limits, and
what must not change.

## Ideas banked for Phase 4

- **Spend freshness where it changes an answer.** Eligibility only flips when a
  level crosses a _requirement boundary_, and the queue is literally a list of
  those boundaries. So refresh eagerly when something is a level away from
  unlocking, lazily otherwise. Most XP gains change nothing on screen.
- **The game notifies level-ups, not us.** So the cost of stale data is low, and
  a prominent manual refresh covers the case where you know something changed.
  Automatic cadence can stay conservative.
- **Refresh-on-resume needs to move.** It currently lives in `StatsView` because
  `refreshIfStale` needs a snapshot and only that view seeds one. When the quest
  panel needs levels, it moves to the shell — but the store must hydrate itself
  first, or it will be inert. Keep the import dynamic, or localForage lands back
  in the initial bundle. Comments in `App.vue` and `StatsView.vue` say the same.
- **UI state must survive backgrounding.** iOS suspends and kills backgrounded
  PWAs, and the app is swapped to rather than watched. Active panel, scroll
  position, current quest and current step all need to persist.

## A note on `.memories/`

That directory holds goldfish checkpoints — a detailed decision log with more reasoning and dead ends than
belongs here. They are **plain markdown and readable without the tool**, so a
machine without the MCP server installed can just open them. Newest last:

```
.memories/2026-09-08/  scaffold
.memories/2026-09-09/  art direction · Workers migration · form-factor pivot
.memories/2026-09-10/  hiscores phase · skill icons and licensing
```

This file is the summary; those are the transcript. If they disagree, this file
is newer.
