# Roadmap and open questions

Where the project stands, what's next, and the decisions whose reasoning isn't
obvious from the code. Written so a session with no prior context can pick up
from here.

Conventions and architecture live in [CLAUDE.md](CLAUDE.md). Third-party
licensing lives in [NOTICE.md](NOTICE.md).

## Status

**0.2.0 is deployed** at <https://stagescape.infinitebit.workers.dev>.

The stats half works end to end: hiscores lookup through the Worker, cached
offline-first, a skills grid that reflows from 320px to docked width.

The quest **dataset** now exists too — 214 quests generated from the wiki and
committed. The quest **engine and UI** — the actual point of the app — are not
built yet, and nothing reads `quests.json` so far.

## Phases

| Phase                           | State | Notes                                                                        |
| ------------------------------- | ----- | ---------------------------------------------------------------------------- |
| 0 — Scaffold                    | done  | Vue 3 + TS, Tailwind v4, PWA, Workers + Static Assets, CI, release-please    |
| 1 — Shell                       | done  | Panel registry, generated routes, tab bar, About panel                       |
| 2 — Hiscores                    | done  | 2a route + parser · 2b store + persistence · 2c skills grid                  |
| 3 — Quest dataset               | done  | 214 quests committed; `build:quests` fetches · parses · cross-checks · emits |
| **4 — Quest engine and queue**  | next  | Eligibility resolution, prerequisite expansion, the queue UI                 |
| Later — ironman requirements    | —     | Currently dropped entirely; see below                                        |
| Later — prices panel            | —     | `prices.runescape.wiki`, same Worker-proxy shape                             |
| Later — wide-and-shallow layout | —     | Tabs to a left strip when short and wide; see CLAUDE.md                      |
| Later — plugin manifests        | —     | The panel registry is already the seam                                       |

## Phase 3: the quest dataset

The source spike is **done**. Verdict: **per-quest-page templates are the
source; `Module:Questreq/data` is a cross-check, not the source.**

Of the three candidates:

1. **Cargo — impossible.** Neither Cargo nor SMW is installed on
   `oldschool.runescape.wiki`; there is no `action=cargoquery`. Don't spend time
   here again.
2. **Per-page templates — chosen.** Complete, canonical, and better structured
   than "parse the prose" implies.
3. **`Module:Questreq/data` — rejected as the source.** Well-formed and acyclic,
   but **21 entries behind the canonical quest list**, and the gap is exactly the
   newest content (The Final Dawn, Sleeping Giants, Beneath Cursed Sands, Land of
   the Goblins, the Sailing-era batch). It also carries 18 entries that aren't
   quests — the 8 achievement diaries, Tutorial Island, Barbarian Training
   sub-tasks. Using it silently omits ~10% of quests, biased toward the ones a
   player is most likely to be looking at.

### How the generator works

The wiki's own quest lists are DPL-generated from per-page templates, so those
templates are upstream of every list page. `list=embeddedin` gives the complete
inventory and a free quest/miniquest split:

| Query                                   | Yield     |
| --------------------------------------- | --------- |
| `embeddedin=Template:Infobox Quest`     | 196 pages |
| `embeddedin=Template:Infobox Miniquest` | 20 pages  |

Full wikitext for all 216 pages costs **5 batched requests** (50 titles each,
`prop=revisions&rvslots=main`). Extract template params by brace matching:

- `Infobox Quest` → name, number, members
- `Quest details` → difficulty, length, requirements
- `Quest rewards` → `qp`

215/216 carry both difficulty and `qp` (the exception is
`Recipe for Disaster/Full guide`, a guide page, not a quest). 19 pages have no
requirements block at all — those are the genuinely requirement-free early
quests, and the Lua module agrees.

Requirements are templated rather than prose, which is what makes this viable:

```
*{{SCP|Agility|62|link=yes}} {{Boostable|no}} {{Questreqstart|yes}}
*Completion of the following quests:
**[[Contact!]]
***[[Prince Ali Rescue]]      <- transitive, ignore
```

**Nesting under the header is transitive expansion**, so direct prerequisites
are the shallowest tier — a clean rule. The parse yields **381 skill
requirements, 276 direct edges and 99 notes** across 214 quests.

Validation is enforced, not aspirational: every prerequisite id must resolve or
generation fails, and the graph is checked acyclic (deepest chain 8, Song of the
Elves) because the queue cannot be ordered otherwise. `Module:Questreq/data` is an
**independent second opinion** whose disagreements are informational — see below
for which side wins and why.

### Two findings that change `src/lib/types.ts`

The `Quest` / `QuestRequirements` sketches need amending before the generator:

- **`{{Questreqstart|yes/no}}` distinguishes "required to start" from "required
  to finish."** That is precisely the question this app exists to answer, and the
  wiki already encodes it per requirement. Add `requiredToStart`. It's annotated
  on 322/415 requirement lines, and `boostable` on 384/415 — so both need an
  explicit **unknown** state, not a `false` default that fabricates certainty.
- **~96 requirement lines are irreducibly free prose** — "The ability to defeat a
  level 83 dragon", "Access to Mort'ton". So **eligibility can never be fully
  computed from levels**, and these must survive as displayable notes. Without
  them the app will confidently call a quest startable when it isn't, which is
  the same failure mode that ruled out Wise Old Man.

Non-skill requirement kinds are a small closed set worth typing rather than
dropping: quest points (14), combat level (1), Kudos (1), and Barbarian Assault
role levels (4).

**`requiredToStart` annotates; it does not gate.** A quest you can start now but
can't finish without another 20 Agility shows as _available_, with the
finish-requirement marked — it isn't filtered out of the queue. Two reasons:
the app's stated question is "what can I start right now," and annotating fails
safe. A wrong annotation is visible and ignorable; wrong gating hides a quest you
could have started, and you'd never know it was hidden.

Deliberately provisional — the call was made without having used the queue on the
device yet, and the docked case may argue for filtering when vertical space is
scarce. Revisit once it's real; the data carries the distinction either way, so
this is an engine decision, not a dataset one.

### Recipe for Disaster: the subquests are the entries, the parent is a label

**Decided.** RFD has 12 pages in the inventory: a parent, ten subquests, and a
`/Full guide` walkthrough. Take the **ten subquests as first-class quests**, drop
the parent as a completable entry, and drop `/Full guide` entirely.

Three reasons, most decisive first:

1. **Monkey Madness II requires `Recipe for Disaster/Freeing King Awowogei`
   specifically**, not RFD as a whole. A composite entry would force us to claim
   MM2 needs all ten subquests — telling the player a quest is blocked when it's
   actually startable. Same invisible-wrongness that ruled out Wise Old Man.
2. **The subquests are already a clean graph:** all eight middle ones require
   `Another Cook's Quest`; `Defeating the Culinaromancer` requires all eight.
   Bundling discards exactly the structure the queue exists to order.
3. **The parent double-counts quest points.** It reports `qp=10` and the union of
   all 14 skill requirements; the subpages carry 1 point each. Counting both
   yields 20. That's load-bearing — 13 quests gate on total quest points,
   including Dragon Slayer II (200) and While Guthix Sleeps (180), so inflated
   points would wrongly unlock the top tier.

Keep `"Recipe for Disaster"` as a **display group** on each subquest so the UI can
render one collapsible row of ten, which is how the in-game journal shows it.
`Infobox Quest` also has a `series` field, so the same grouping generalizes to
the Elf and Desert Treasure series later — but treat series as display only,
never as a dependency.

Bonus: the ~52 unparsed lines that looked like the worst of the job were **all on
the parent page**. Dropping it removes nearly all of them, so this decision makes
the generator simpler rather than adding a special case.

### Staleness: `--check`, and the job that should run it

The wiki moves without telling us — two quests were added this month. Nothing in
`npm run build` touches the wiki, deliberately: `.cache/wiki/` is developer-local
and gitignored, `src/data/quests.json` is committed, and regeneration is a manual
step with a reviewable diff. So the wiki changing can't break a build or alter
the app. It can only make the committed dataset quietly wrong.

`npm run build:quests -- --check` is the answer. It compares the committed
dataset against the live wiki using **only the inventory and revision ids, no
page content** — about seven small requests — and exits non-zero on drift,
reporting quests added, removed, or edited since generation. Revision ids live in
`src/data/quests.sources.json`, committed beside the dataset and never shipped to
the client.

It works: minutes after the first dataset was written, `--check` flagged that
`A Ruff Situation` had been edited.

**Still to do: a scheduled job that runs it.** A weekly GitHub Action opening an
issue on drift turns "hope someone remembers" into a notification, while keeping
regeneration a deliberate human step. Note open question 5 — the deploy job has
no `workflow_dispatch` — so give this one a manual trigger from the start.

### When the two sources disagree, the page wins

**Decided.** The quest page is authoritative; `Module:Questreq/data` is
informational and **never blocks generation.**

The cross-check surfaces ~7 genuine disagreements — Watchtower Magic 14 (page)
vs 15 (module), Elemental Workshop I Mining 20 vs 30, The Knight's Sword Mining
10 vs 15. Only the live game settles them, and adjudicating would mean the
dataset can't be regenerated until someone logs in.

Deferring to the page is the right default for a reason beyond convenience: the
page is what a player sees when they check the wiki themselves. Matching it means
the app never contradicts the source the player would consult. Being right in the
abstract while disagreeing with the wiki would be worse than being wrong the same
way the wiki is.

So the cross-check's real value is **finding bugs in our parser**, not refereeing
the sources — and it has earned its place there. It caught four parse bugs by
flagging missing edges, including a line on While Guthix Sleeps reading "Attack +
Strength ≥ 130, OR Attack 99, OR Strength 99" that the parser had reduced to a
flat 99 Attack requirement. Lines naming several skills are now notes, not
requirements: ambiguity must degrade to prose, never to false certainty.

### Ironman requirements are dropped, knowingly

Quest pages keep ironman-specific requirements in a separate `ironman` param, and
the generator doesn't parse it. `Module:Questreq/data` flags 20 of them, so the
scale is known: Animal Magnetism needs Prayer 31 on an ironman and the dataset
says nothing of the sort.

This matters more than it looks, because the app already supports ironman
hiscores and stores account type in settings — so for those players the dataset
is quietly incomplete, which is this project's least favourite failure shape.

Deferred rather than dismissed. Two costs to weigh when it comes up: it needs a
type change (an `ironmanOnly` flag on `SkillRequirement`, or a parallel list),
and the `ironman` param is far prosier than `requirements` — mostly "a method to
obtain X" trees — so it may only partly reduce to structured data. The honest
interim position is to say so in the UI rather than imply completeness.

### The messy tail, all bounded

- Four one-off header phrasings ("Must have completed the following quests:") —
  a small regex widening.
- Three miniquest pages yield a numeric `difficulty` (Alfred Grimhand's
  Barcrawl, Enter the Abyss, Family Pest).
- Two prereq links need normalizing: an underscore in an RFD subpage link, and a
  Karamja diary reference.
- `Module:Questreq/data` itself has **mixed tab and space indentation**, so any
  parser for it must be brace-based, not indentation-based. It also carries a
  `'boosted'` typo for `'boostable'` and a `'Watchtower '` with a trailing space.

Static and committed because the app must work offline and a diffable,
hand-correctable dataset beats a fragile live query.

Budget for this still being messier than the hiscores were. Two precedents: the
hiscores response gained a 24th skill (Sailing) with no announcement, and the
wiki's "freely downloadable" icons turned out not to be licensed to us.

### Prior art: RuneLite's Quest Helper

Worth knowing, because it looks like it solves our problem and doesn't.

**It reads your quest _progress_ from the running game, not requirements.** Every
quest has a server-side progress value; the plugin reads it directly
(`quest.getState(client)` → not started / in progress / finished, plus a step
number). Exact, free, instantly current.

**Its requirements are entirely hand-written.** The repo has 1,075 files, 728 of
them Java, and **zero data files** — no JSON, no CSV, nothing wiki-generated.
Requirements are literal code per quest (`new SkillRequirement(Skill.SLAYER, 18)`),
across 462 quest classes.

Two things follow:

- **Hand-entered completions here are structural, not a shortcoming.** Quest
  Helper gets state free only because it runs _inside the client_. We can't:
  hiscores don't expose quest state, the Fan Content Policy §6.1.2 forbids
  third-party clients, and the whole premise is a second screen where a desktop
  client plugin isn't running. Nobody gets requirements free; progress is the only
  part the game gives away. This is why export/import is load-bearing.
- **Their choice to hand-write is evidence about scope, not about the wiki.** They
  need per-step items, dialogue and tile locations, which no wiki field carries;
  once you're writing that, hardcoding requirements alongside is free. It costs
  them a code release per new quest. Our need is just requirements for ordering a
  queue — the part the wiki does structure. So wiki data supports a **planning**
  tool; a **guided walkthrough** would be a far bigger lift.

Banked, not adopted: it's BSD-2-Clause and actively maintained, so those
hand-curated requirements would make a strong third cross-check — validated
against the live game rather than the wiki checking itself. Extracting them means
parsing Java. **Read NOTICE.md and settle attribution before using any of it**;
mixing in another project's curated data belongs there deliberately.

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
