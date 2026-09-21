# Roadmap and open questions

Where the project stands, what's next, and the decisions whose reasoning isn't
obvious from the code. Written so a session with no prior context can pick up
from here.

Conventions and architecture live in [CLAUDE.md](CLAUDE.md). Third-party
licensing lives in [NOTICE.md](NOTICE.md).

## Status

**0.3.1 is deployed** at <https://curators-journal.infinitebit.workers.dev>, and the
CI deploy path is now proven — see open question 4.

The stats half works end to end: hiscores lookup through the Worker, cached
offline-first, a skills grid that reflows from 320px to docked width.

The quest **dataset** (214 quests), the **engine** (`src/lib/quests.ts`) and the
**store** (`src/stores/quests.ts`) all exist and are wired together: the Quests
panel loads the dataset on demand and reports how many quests you could start
right now, against live levels.

Browsing, searching, filtering, add-to-queue and quest detail all exist now —
see Phase 4 below. Quest detail is finished: it carries the items a quest asks
you to bring (4d′) and the full prerequisite chain behind it rather than one
level (4d″). Export/import (slice 4b′) landed ahead of all of them, from the
Settings panel.

The **queue is real** (4e): it leads with what you can start, keeps the ordered
plan and your goals behind a tab switch, and lets you start and finish a quest
without leaving the panel. Curating moved wholesale to the Quests panel in the
process — see 4e below for why the Queue has no "add" button.

**Phase 4 is done** — 4f moved refresh-on-resume from `StatsView` to the shell,
the last slice. The more interesting question now is whether the shell itself
is right — nothing here has been used on a docked iPad yet, and the collapse
thresholds and the bottom tab bar are both unmeasured guesses.

**Phase 5 is half built.** The web and Worker side exists (5a–5c: snapshot
validator, D1 and `/api/sync`, the sync store and its merge toggle); the
companion RuneLite plugin (5d–5f) does not. The web side merges synced quest
state into the quest panel behind a toggle — the first time anything but the
player has written to quest progress, which is why the section below spends
most of its words on keeping the two apart.

**The web side of diary sync is done** — see "Diary sync and account-hash
linking" in Phase 5: diary tiers on the wire, the merge, locked rows in the UI,
and a `/sync?hash=` link so the plugin's QR code can fill in the account hash.
None of it has met real plugin data yet, because the plugin (5d–5f) does not
exist. **Phase 6 (achievement diaries) is done** and has its own section below.
Its one open question — where the diary list lives (6e) — is settled: diaries
are a mode inside the Quests panel, not a tab of their own.

## Phases

| Phase                           | State | Notes                                                                          |
| ------------------------------- | ----- | ------------------------------------------------------------------------------ |
| 0 — Scaffold                    | done  | Vue 3 + TS, Tailwind v4, PWA, Workers + Static Assets, CI, release-please      |
| 1 — Shell                       | done  | Panel registry, generated routes, tab bar, Settings panel                      |
| 2 — Hiscores                    | done  | 2a route + parser · 2b store + persistence · 2c skills grid                    |
| 3 — Quest dataset               | done  | 214 quests committed; `build:quests` fetches · parses · cross-checks · emits   |
| 4 — Quest engine and queue      | done  | Engine, detail, queue, reorder (4e′) and refresh-on-resume (4f) all built      |
| 5 — RuneLite sync               | half  | Web + Worker side done (5a–5c); the plugin itself (5d–5f) not started          |
| 5+ — Diary sync and linking     | done  | Web side of 5g–5k: diary tiers on the pipe, locked rows, `/sync?hash=` link    |
| 6 — Achievement diaries         | done  | Dataset, engine, store, UI. 6e settled: a mode inside Quests, mode in the path |
| 7 — Bosses                      | half  | 7a–7c built: tab bar, the join, the dataset. Panel (7d) and drops (7e) to come |
| Later — ironman requirements    | —     | Currently dropped entirely; see below                                          |
| Later — prices panel            | —     | `prices.runescape.wiki`, same Worker-proxy shape                               |
| Later — wide-and-shallow layout | —     | Tabs to a left strip when short and wide; see CLAUDE.md                        |
| Later — plugin manifests        | —     | The panel registry is already the seam                                         |

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

## Phase 4: the engine and the queue

### Two panels, not one

**Queue** and **Quests** are separate panels, because they answer different
questions on different rhythms. The queue is "what am I doing next" — short,
ordered, returned to repeatedly mid-session, and the reason the app gets swapped
to. Quests is "what's out there / tell me about this one" — browsing, searching
and filtering 214 entries, done occasionally and at length.

Folding both into one panel costs either a mode toggle (vertical space, the
scarce resource in the docked case) or scrolling past the queue to browse — and
the docked case is exactly where the queue matters most.

Consequences worth holding onto:

- **Four tabs is the label limit.** `.tab-strip:has(.tab:nth-child(5))` already
  drops every label at five, so Queue · Quests · Stats · About keeps its labels
  and the banked prices panel would silently flip the bar to icon-only. That's
  self-enforcing, not a thing to remember — but decide whether prices eventually
  earns a tab or lives inside Stats.
- **Icons:** `scroll` for Queue, `openBook` for Quests. Both game-icons, and
  distinguishable at 20px, which matters once labels go. Note the row then mixes
  two packs — game-icons on the 512 grid beside Phosphor's `chart` and `gear` on
  256 — so check the four together on device.
- **Quest detail is a full-panel view with a back button**, not an overlay.
  Reachable from both panels — Quests today; Queue joins once it has real rows
  to tap in 4e. In the docked case there may be ~200px of height, where a
  modal is unusable.

**Built in 4d: a route outside the registry, and two shell changes it forced.**
`/quests/:id` isn't a registry panel — it never appears in the tab bar — but
carries `meta.panelId: 'quests'` so the shell still knows which panel it was
reached from. That one convention paid for two things at once:

- `TabBar.vue`'s active check moved from `route.path === panel.path` to
  `route.meta.panelId === panel.id`. Exact-path matching would have dropped
  the Quests tab's highlight the moment the path became `/quests/some-id` —
  the generalization is correct for any future full-panel drill-down, not
  just this one.
- The header title can't be `activePanel.title` alone anymore — a quest's name
  isn't known at route-definition time. `usePageHeader.ts` is a small shared
  `ref` the shell (always in the initial bundle) reads and a lazy-loaded view
  writes, sidestepping the alternative of statically importing the quests
  store into `App.vue`, which would have pulled the dataset and localForage
  into the entry chunk. The back button lives in this same shared header slot,
  on the right, per the iPadOS window-menu finding above.

**Progress gets marked from quest detail (4d), not from a Quests-panel row.**
`cycleProgress()` existed since 4b with a doc comment claiming the opposite —
"a single tap on a quest row" — which never got built and turned out to be the
wrong call once the list existed: a tap on one of 214 rows is reserved for
opening that quest's detail, where there's room to show _why_ it's blocked, not
a blind whole-quest toggle. Add-to-queue is the one action that did land on the
list row directly (4c), because it has nowhere else to go yet and doesn't need
that context.

### Two things the engine settled

**Quest progress is three-state: `todo` / `doing` / `done`.** Not a checkbox.
This looked like art direction — the tokens borrowed from the in-game journal —
but it turns out to be load-bearing: 14 prerequisites need the earlier quest only
_started_, and a boolean cannot represent that without guessing in one direction.
`src/lib/quests.ts` satisfies a "started" prerequisite with `doing` or `done`,
and marks it `uncertain` when there's no record at all — a caveat to show, never
a reason to call a quest blocked.

**The queue is curated, and therefore precious.** You pick goals and the plan
works backwards through prerequisites; it is not all 214 quests ordered, which
would be a firehose rather than a plan. So the chosen goals are **hand-entered,
unrecoverable user data** in the same category as completions: IndexedDB, and in
the export. Not component state.

### The engine's one rule

`src/lib/quests.ts` is conservative in exactly one direction: **when the data
doesn't say, never claim a quest is out of reach.** A wrong "you can start this"
is visible and self-correcting — you open the quest and find out. A wrong
"blocked" hides a quest you could have done, and you never learn it was hidden.

That's why unknown `requiredToStart` doesn't block, a missing skill level reports
`have: null` for the UI to render as _unknown_ rather than _too low_, and
`combatLevel()` returns `null` instead of computing a low level from absent data.

Measured against the real dataset: 73 of 214 startable on a fresh account (49 of
those finishable as-is), a 36-step plan for Dragon Slayer II from nothing, no
ordering violations, and the same goals always produce the same plan — which
matters because the plan is persisted and returned to.

### Slices

| Slice | Contents                                                   | State |
| ----- | ---------------------------------------------------------- | ----- |
| 4a    | `src/lib/quests.ts` — eligibility, plan ordering           | done  |
| 4b    | `src/stores/quests.ts` — dataset load, progress, goals     | done  |
| 4b′   | Export / import — do this before any UI invites data entry | done  |
| 4c    | Quests panel: list, search, filters, add to queue          | done  |
| 4d    | Quest detail: full-panel, from either panel                | done  |
| 4d′   | Items required — dataset field, generator, detail view     | done  |
| 4d″   | Transitive prerequisite chain on quest detail              | done  |
| 4e    | Queue panel: next up, plan, goals, remove, start/finish    | done  |
| 4e′   | Reorder goals — the last piece of 4e                       | done  |
| 4f    | Move refresh-on-resume from `StatsView` to the shell       | done  |
| 4g    | Description, start point, kills, rewards, chaptered layout | done  |

### 4d′: items required — a real, previously-unscoped gap

Found while looking at **A Night at the Theatre** in the new detail view: it
shows one prerequisite quest and nothing else, which reads as suspiciously
thin for a Master-difficulty quest. Checked against the live wiki page (both
rendered and `?action=raw`) and against `scripts/build-quests.ts` — this
isn't a parse bug, it's a field that was never scoped in. The quest genuinely
has no direct skill requirements; what the wiki page **does** list, that we
don't capture anywhere, is required and recommended items:

```
|items =*[[Ivandis flail]] or [[Blisterwood flail]]
*[[Saw]] ([[crystal saw]] also works)
*[[Ghostspeak amulet]] ([[Morytania legs 2]] or better also work)
*Any [[axe]] besides the [[blessed axe]]

|recommended =
*{{SCP|Combat|95|link=yes}}
*[[Stamina potion|Stamina]] or [[Energy Potion]]s
*[[Drakan's medallion]]
...
```

Both are parameters on the same `Quest details` template already parsed for
`requirements`/`difficulty`/`length` — no new template to find, just two more
params to read. Unlike skill requirements, `items` doesn't use the `{{SCP|...}}`
structured markup — it's a bulleted list of free text and `[[wikilinks]]`, closer
in shape to the ~96 free-prose requirement lines that already land in
`Quest.notes`. That means it can't be checked against inventory (no "do you
have this" state to compute), only displayed — same treatment as notes, not
as a new gate.

Plan:

**Built.** `parseItemList` in the generator, `QuestItemLine` in
`src/lib/types.ts`, `QuestItemLines.vue` rendering both lists on quest detail.
The engine is untouched, as planned — `evaluateQuest` never reads these.

Surveying the cached wikitext before writing the parser contradicted three
assumptions in the plan above, all in the same direction: the field is bigger
and more structured than "a bulleted list of free text" suggested.

- **Coverage is near-universal, not sparse.** The plan guessed "most
  early/low-level quests won't have either param." In fact 213 of 216 pages
  carry `items` and 205 carry `recommended`; 200 and 201 respectively say
  something other than "None". So an empty array now means the quest really
  needs nothing, and a _drop_ in the counts after a regen means the wiki
  renamed the param — which is why `parseAll` reports item and heading counts.
  With no `Module:Questreq/data` equivalent to cross-check against, that report
  is the only tripwire this field gets.
- **Flattening the list would have told players to bring the wrong items.**
  Heroes' Quest splits its items under "If you are a Black Arm Gang member:"
  and "If you are a Phoenix Gang member:" — alternatives, not a sequence.
  Flattening asks for both. That's the Monkey Madness II / composite-RFD
  failure again, in a third place, so the same answer applies: carry the
  structure rather than discard it. `QuestItemLine` is `{ text, heading?,
depth? }` instead of the planned bare `string`.
- **`recommended` isn't a second item list.** It also carries combat levels,
  travel routes and "9 empty inventory slots". The section is therefore titled
  "Recommended", not "Also bring".

**Headings are detected by a trailing colon**, which was measured rather than
guessed: across every non-bullet line in the dataset it catches 15 of 16 with
no false positives. Wholly-bold looked like the better signal and isn't — The
Tourist Trap's bolded line is a _note_, not a heading, and would have been
promoted. The one miss is a bare "Recommended" on Forgettable Tale, which
renders as an ordinary line. Prefer that failure: a heading shown as a bullet
is untidy, a note shown as a heading invents structure.

**Nesting is kept as `depth`, not flattened** — reversing the plan's call. It
reaches 4 levels on 90 pages, and a sub-bullet is usually a detail hanging off
the line above ("Additional antipoison when fighting the hespori"), which reads
as a separate requirement once promoted to a sibling.

**The cost is size, and it's larger than a schema tweak.** `quests.json` went
from ~108 KB to 297 KB built, gzip ~14 KB → ~68 KB — items are now most of the
dataset. Both bundle invariants still hold (it's its own lazily-loaded chunk,
`localforage` and the dataset are both absent from the entry chunk), and the
service worker precaches it once. But it is the app's largest asset by a wide
margin now, and if that ever needs cutting, `itemsRecommended` is roughly half
of it and the half that gates nothing.

**Levels named in an item line are tinted, and the rule is anchored.**
`mentionedLevel` in `src/lib/quests.ts` reads a skill or combat level stated at
the _start_ of a line ("Combat 95", "Prayer 43 for overhead protection") and
compares it to the player's. Anchoring is the whole trick: scanning anywhere in
the line matches numbers belonging to items rather than levels — "1-2 prayer
potions", "12 Magic logs (can be noted)", "3-100 magic logs" — and each would
have been painted as a level you have or lack. The anchor drops all 48 such
false positives and still reaches 203 lines, 139 of them combat.

**Amber for unmet, not red**, which is the same judgement `requiredToStart`
made. Nothing in these lists blocks anything; they're advice. Red is the app's
"blocked", and spending it on a recommendation would say "you can't do this"
about a quest you can in fact start. Unknown levels stay uncoloured — the third
state, never collapsed into "too low".

The engine doesn't call `mentionedLevel` and doesn't know it exists; it is
presentation sugar living in `lib` only because it must stay pure.

Verified by spot-checking generated entries against their wiki pages by hand —
Heroes' Quest for the branches, A Night at the Theatre for nesting, Cabin Fever
for the no-items-but-11-free-slots prose — plus the parse report's counts. Not
a scripted diff; no second source exists to diff against.

### 4d″: the transitive chain isn't visible on a detail page

The other half of what made A Night at the Theatre read as "not clear what's
needed": its real difficulty is a six-quest chain behind A Taste of Hope
(Darkness of Hallowvale → In Aid of the Myreque → In Search of the Myreque →
Nature Spirit → Priest in Peril → The Restless Ghost), each with its own skill
gates. That chain is correctly modeled — `buildPlan` already expands it fully
for the queue — but `QuestDetailView.vue` only ever shows the **direct**
prerequisite (`quest.requirements.quests`), one level deep. Seeing the whole
shape means tapping through five more quests one at a time.

**Built.** `prerequisiteChain(id, index)` in `src/lib/quests.ts`, rendered by
the detail page's "Quests first" section. Engine only, as anticipated — no
store or type changes.

**It is a separate function, not a flag on `buildPlan`,** and the reason is
sharper than "the done-filter": `buildPlan` also stops descending the moment a
prerequisite is satisfied, so it prunes whole satisfied branches. Reusing it
would make a chain shrink as you complete it, which is right for a queue and
wrong for "why is this hard". `prerequisiteChain` doesn't take `PlayerState` at
all — it's structural, and therefore _cannot_ filter by progress. Only the
status stripes and the remaining count read progress.

Measured against the dataset: A Night at the Theatre gives exactly the seven
expected, deepest first, with A Taste of Hope marked direct and listed once
rather than twice. Dragon Slayer II gives 35, Defeating the Culinaromancer 47,
Cook's Assistant none. Root never appears in its own chain, no id twice, and
every prerequisite precedes the quest needing it.

**Long chains are collapsed to six rows behind a "Show all" button** — an
unplanned addition, forced by seeing it: 35 oak rows is a wall between the
quest's status and everything under it, and vertical space is the scarce
resource in the docked case. Truncation is honest here only because the order
is dependency order, so the visible rows are the ones to do first and the
hidden tail is the distant future. The threshold (over 10 collapses to 6) is a
guess made at desk width; check it against the docked case.

Two smaller calls worth keeping:

- **"Needs finished/started" shows only on direct prerequisites.** That text
  describes what _this_ quest asks for; on a quest present because an ancestor
  needs it, the same words would attribute the requirement to the wrong quest.
- **The expander is an oak button, not parchment.** Parchment was the first
  instinct and is wrong twice — CLAUDE.md puts buttons on oak, and
  `.pressable` hard-codes an oak press state, so a parchment button would flip
  brown under the thumb.

### 4e: the queue, and the workflow rethink it forced

**Built.** `QueueView.vue` renders _Next up_ over a tabbed _Plan_ / _Goals_.
Quest detail gained a goal toggle, the Queue lost its add button, and
`/queue/:id` exists. Three things drove the shape, and all three came from
looking at real numbers or the real screen rather than from the plan:

**A plan is long, so the panel can't lead with it.** Dragon Slayer II alone
expands to 36 steps; two goals reach 44. The queue's question is "what am I
doing next", asked mid-session with the game above, so the panel leads with the
startable steps and keeps the ordered plan behind a tab, collapsed to five.
Same truncation argument as the prerequisite chain, and safe for the same
reason: dependency order means the visible rows are the near future.

**Plan and goals are different workflows, not two halves of a view.** Stacked,
they also read as redundant — every goal appears in both, and Dragon Slayer II
sits at step 36 of its own plan. Tabs let one panel serve both and buy back the
height. The selected tab is dark oak with gold, matching the shell's tab bar and
quest detail's progress switcher; the panel carries its own parchment ground so
its rows visibly belong to the selected tab.

**"Add" was a mode change wearing the costume of an action.** The Queue's "Add
another" handed you to the Quests panel for an open-ended session you never
returned from. So curating is now a Quests-panel activity end to end — search,
open a quest, read why it's hard, add it there — and the Queue has no add
affordance at all, because the tab bar is always one tap away. The only
exception is the empty state, which keeps a link named for its destination
("Browse quests"): with nothing queued there is no session to lose.

Two fixes fell out of that:

- **`/queue/:id`.** Quest detail hardcoded `/quests` as its back target, so
  opening a plan row from the Queue stranded you in a 214-row list and moved
  the tab highlight with it. The same view now mounts under both panels and
  reads `meta.panelId` for its back target and its own outgoing links, so a tap
  three deep into a chain stays in the panel it started in. Context lives in
  the path because that survives the relaunch a remembered variable wouldn't.
- **Start / Finish on each Next up row.** Marking a quest done cost four
  interactions and two navigations from the panel you return to mid-session.
  The button names the _transition_, not the state, which works because
  `buildPlan` drops finished quests — a row here is only ever todo or doing, so
  there is no third case to decode. Finishing one promotes the next into its
  place.

**`buildPlan` now walks goals in the caller's order** rather than sorting their
ids. Sorting quietly made reordering meaningless: the plan came out identical
however you arranged your goals. Prerequisites stay sorted, since nobody chose
their order, and the plan is still deterministic — the goal list is an explicit
sequence. Measured: swapping two goals moves Song of the Elves from step 43 to
step 14, with the same 44 steps and dependency order intact either way.

**4e′, reorder goals, is built.** `moveGoal(id, direction)` in the store swaps
a goal with its neighbour and no-ops past either end; the Goals tab pairs it
with `arrowUp`/`arrowDown` buttons per row, disabled at the ends rather than
hidden so the row's width doesn't shift as you reorder. Side by side, not
stacked — `.tap`'s 44px floor is per button, and stacking would have doubled
this row's height against every other row in the list. The Goals `<ul>` is a
Vue `<TransitionGroup>` so a swap slides into place (`.goal-move` in
`style.css`) instead of jump-cutting; only the FLIP move is animated, and the
existing global `prefers-reduced-motion` rule already shortens it for anyone
who asked for that, so no separate motion gate was needed.

**Still open, and worth checking on the device before building more:**

- **The collapse thresholds are desk-width guesses.** The plan shows 5 of 44
  and the prerequisite chain 6 of 35. Nobody has seen either in the docked
  case.
- **UI state still doesn't survive backgrounding**, and the queue's tab
  selection now joins the list of things that should (with active panel, scroll
  position and current step). It's deliberately a plain `ref` rather than a
  one-off persistence key — see the banked idea below.
- **The docked layout.** Phase 4 is now closed and "tabs to a left icon strip
  when short and wide" has been in Later since the start. The queue is the
  panel you'd actually live in down there, so this is the moment to find out
  whether the bottom tab bar is the wrong shape.

### 4b′: the safety net, done before any UI invites data entry

`persist.ts` called export "the real safety net" and CLAUDE.md said "this is
why export/import exists" while **neither was true — nothing implemented it.**
The quest store is the first thing in the app holding genuinely unrecoverable
data, and Safari evicts IndexedDB after ~7 days idle for non-installed sites.
Building a UI that invites someone to hand-enter 214 completions before that
existed was the wrong order, which is why this jumped the queue.

**Built:** `src/lib/backup.ts` (pure — builds and validates the backup shape,
no DOM) plus export/import controls in the Settings panel. Covers exactly the
hand-entered fields — `settings.username`, `settings.accountType`,
`quests:progress`, `quests:goals` — and nothing fetched, since cached hiscores
restore themselves from a username. A version field (`1`) and an `app` marker
guard against importing garbage or a foreign JSON file; import replaces the
current state wholesale after a confirm, rather than attempting a merge.

### 4f: refresh-on-resume moved to the shell

**Built.** The `visibilitychange` listener that calls `hiscores.refreshIfStale()`
now lives in `App.vue`, not `StatsView.vue`. It had been scoped to that view
because `refreshIfStale` needs an existing snapshot and StatsView was the only
thing that seeded one — an app-level listener would have done nothing on every
other panel while still costing them the store's chunk.

That stopped being true once `hiscores.ensureLoaded()` (built for the quest
panel, to fix the same "no username" bug) let any panel hydrate a snapshot
from settings and cache. `refreshIfStale` is a quiet no-op with nothing to
refresh, so promoting the listener to the shell is safe even on a cold load
into a panel that hasn't fetched anything yet — it just does nothing until
something has.

The move only works because it follows the same shape as `App.vue`'s existing
`refresh()` handler: the hiscores store is imported dynamically inside the
handler, not statically at the top of the file, so localForage stays out of
the initial bundle. Verified after the move — `cooks-assistant` and
`localforage` are still both absent from the entry chunk.

### 4g: description, start point, kills, rewards — more of the wiki template, same fields

Requested as "pull in the wiki table data" — quest detail was already reading
`Quest details` for `difficulty`/`length`/`requirements`/`items`/`recommended`,
but that template also carries `description` and `start`, and `Quest rewards`
carries a `rewards` list beside the `qp` already read. No new template to
find, same shape as 4d′: more params off pages already fetched and parsed.

**Built.**

- `description` splits on blank lines into paragraphs (most pages write one,
  a few write two or three) and is shown above Progress/Queue as context for
  the decision those make, not a result of it.
- `startPoint` is `start`, plain-texted — shown alongside description.
- `kills` reuses `parseItemList`/`QuestItemLine` — same bulleted shape as
  `items`, so no new parser.
- `rewards` reuses the same list parser on the `Quest rewards` template's
  `rewards` param.

Neither `kills` nor `rewards` gates anything or lands in `QuestRequirements` —
same reasoning as `itemsRequired` in 4d′: the engine never reads them, so they
don't belong beside the fields `canStart`/`canFinish` gate on.

**A latent bug in `plainText` surfaced immediately.** Its `{{SCP|...}}`
expansion used `(\d+)` for the number, which is correct for every skill
_requirement_ SCP has ever carried (1–99, no thousands separator) but wrong
for a reward's XP amount: `{{SCP|Smithing|80,000}}` matched only as far as
the comma, so the first `rewards` build read "Smithing 80,000 experience" as
"Smithing 80 experience" — off by 1000x. Fixed to `([\d,]+)`. Existing
requirement/item parsing is unaffected since those numbers never had commas
to lose.

**Rewards needed `QuestItemLines` to stop tinting numbers.** The component's
level-coloring (`mentionedLevel`) reads a line's leading number as a level to
check against the player's own — right for `items`/`recommended`, wrong for
`rewards`: "Smithing 80,000 experience" isn't a requirement to compare against
the player's Smithing level. Added a `colorLevels` prop, off for rewards only.

**The cost is size, again.** `quests.json` went from 297 KB to 463 KB built
(gzip ~68 KB → ~129 KB, inside its own lazily-loaded chunk). Both bundle
invariants still hold — verified `cooks-assistant` and `localforage` are both
absent from the entry chunk after this build.

**Follow-up: eight same-weight sections read as a wall, so they're chaptered.**
Once 4g's fields were live, Skills / Quests first / Quest points / Combat
level / Notes / Monsters to kill / Items needed / Recommended / Rewards all
carried the same small-bold-label treatment, in a row — nothing told them
apart at a glance. Weighed three fixes as mockups (chaptered scroll, tabs
that become columns when docked, an action-bar-plus-accordion split by
what gates `canStart`) before touching the real component; picked the
chaptered scroll. It adds no interaction — everything still just scrolls —
and reuses `font-display`, the journal's own serif face, as a second,
heavier hierarchy level above the existing bold labels: **What it takes**
(Skills, Quests first, Quest points, Combat level, Notes — everything that
gates or almost-gates starting), **Before you go** (Monsters to kill, Items
needed, Recommended — prep, gates nothing), **When it's done** (Rewards). A
chapter with nothing in it doesn't render its title — Cook's Assistant has
no skills, chain, quest points, combat level, or notes, so it goes straight
from Queue to "Before you go".

### What 4b left in place

`useQuestsStore` is the seam every quest panel goes through:

- **`ensureReady()`** — dataset _and_ levels, in one call. Call it on mount.
  Views should not call `ensureDataset()` alone; that's what produced the bug
  where a cold load reported no username because only Stats fetched levels.
- `statuses` (a `Map<id, QuestStatus>`), `plan`, `questPoints`,
  `completedCount`, `levelsKnown`, `awaitingLevels`.
- `cycleProgress(id)` for a single tap: todo → doing → done → todo.
- `toggleGoal(id)` / `addGoal` / `removeGoal`.

**`levelsKnown` and `awaitingLevels` are separate on purpose.** "No account
configured" and "levels still loading" look identical in the data and must not
read identically in the UI — conflating them is what made the panel tell the
player to set a username they had already set.

### Invariants worth not breaking

- **Neither the dataset nor localForage may enter the entry chunk.** Verify with
  `npm run build`, then grep the `index-*.js` named in `dist/client/index.html`
  for `cooks-assistant` and `localforage`; both must be absent. The dataset
  should appear as its own ~108 KB `quests-*.js`.
- **Ids derive from wiki titles**, so a page rename orphans a completion. The
  dataset keeps the title, so a rename is detectable; `--check` should treat an
  id change as a breaking diff rather than a routine one.
- **A full 214-quest sweep costs ~0.16 ms**, so recomputing `statuses` freely is
  fine. It was 300× worse before `evaluateQuest` stopped totalling quest points
  for quests that don't gate on them — if that regresses, look there first.

## Phase 5: RuneLite sync

The constraint at the top of CLAUDE.md is that the hiscores don't expose quest
state, so completions are hand-entered. A RuneLite plugin is the one source
that _does_ know. Phase 5 adds a companion plugin that pushes quest state to our
own backend, and a web side that pulls it down — without ever letting it touch
the hand-entered half.

### The plugin lives in its own repo

Plugin Hub submission is a PR to `runelite/plugin-hub` adding a file that names
a **repository URL and a commit hash**. The referenced repo is built standalone:
Gradle at the root, its own licence, its own tags. A Java project wedged into a
subdirectory here doesn't fit that shape, and release-please — which reads every
Conventional Commit in this repo — would start versioning Curator's Journal off plugin
commits.

So: **`curators-journal-runelite`, separate and public.** What crosses between them is
the wire format and nothing else. `src/lib/sync.ts` is the spec; the Java side
is a hand-copy of it. Two implementations of a twenty-line contract is cheaper
than any mechanism for sharing one across two build systems.

### Synced data is a third kind of data

CLAUDE.md names two kinds and insists they not be conflated. This adds a third:

- **Fetched, read-only** — hiscores, prices. Disposable, refetchable.
- **User-owned, authoritative, precious** — progress and goals. Unrecoverable.
- **Synced, semi-trusted, disposable** — authoritative about the game, but it
  arrives over an open endpoint, so it is never trusted enough to write.

The rules that keep the third from eating the second:

- It lands under its own key, `sync:snapshot`, written only by the sync store.
- **The merge happens in a computed, never on disk.** The engine and the views
  read `effectiveProgress`; `quests:progress` has no code path that sync can
  write. Garbage in the database can't corrupt the precious half because the
  code that would do it doesn't exist.
- **The merge is additive only.** A synced `done` can promote a local `todo`; a
  local `done` is never demoted. So a bad snapshot can only over-report, and
  toggling the merge off is a complete undo.
- It is **excluded from the backup shape**, for the same reason cached hiscores
  are: it refetches itself, so it isn't precious.
- Validation lives in a pure `src/lib` module shared with the Worker, so the
  write endpoint rejects exactly what the client would reject.

### No auth, deliberately

WikiSync's model, and for WikiSync's reason. Yes, anyone holding an account hash
can write garbage to that row. The cost of that is bounded by the separation
above: the next plugin sync overwrites it, and in the meantime it's "someone
spoofed me, toggle the merge off" rather than "my quest log is gone." Real
accounts would mean adding a server-side user concept to an app that has none,
to defend against a nuisance.

**Keyed on `client.getAccountHash()`, not the RSN.** Settings already holds a
username, so keying on the RSN would need no pasting at all — but an RSN is
public and enumerable, so garbage could be sprayed at every name on the
hiscores. A hash is opaque, so one paste from the plugin panel into Curator's Journal
buys spoof-resistance for free. It is an identifier, not a secret: anyone who
has it can read and write that row, and that is accepted.

The endpoint still needs **abuse caps** — a payload size limit, unknown quest
ids rejected before the write, one row per key so a key can't grow. That is
keeping an open POST route from becoming free storage for strangers, not
protecting the player from spoofing.

### D1, and specifically not KV

The storage is one JSON blob per player, which is KV's shape. Pick D1 anyway:
**KV is eventually consistent**, up to ~60s, and the entire interaction is "hit
Sync in RuneLite, hit Refresh in Curator's Journal." A stale read there doesn't read as
eventual consistency, it reads as broken. D1 is read-after-write consistent.

One table, one row per account hash: the payload as JSON text, plus a schema
version and a received-at timestamp. The schema version is what lets a plugin
running an older format be rejected cleanly rather than parsed into nonsense.

### The wire format

```jsonc
{
  "schemaVersion": 1,
  "accountHash": "…",
  "quests": { "cooks-assistant": "done", "dragon-slayer-i": "doing" },
}
```

`quests` is nested rather than being the top-level map on purpose — the same
pipe could later carry diaries, combat achievements or the collection log, and a
bare map would have to be broken to add them. Don't design those in; don't make
the shape hostile to them either.

Ids are ours, not the plugin's. RuneLite exposes quest state through its `Quest`
enum and `quest.getState(client)` (`NOT_STARTED` / `IN_PROGRESS` / `FINISHED`),
which maps cleanly onto todo / doing / done, read on the client thread. The
plugin matches those names to our dataset by wiki title and **logs whatever
fails to match** — that list is the drift detector between the plugin and
`build:quests`.

### The §6.1.2 wording gets narrower

CLAUDE.md and NOTICE.md both say Curator's Journal reads public hiscores over HTTP and
never touches the game client, so it isn't a third-party client. The plugin runs
_inside_ RuneLite, which Jagex permits, so it isn't one either — but the
sentence as written stops being true of the project as a whole and needs
rewording rather than being left to rot.

Plugin Hub also requires the plugin repo carry its own licence. Apache-2.0 is
fine; most RuneLite plugins are BSD-2.

### Slices

| Slice | Contents                                                      | State |
| ----- | ------------------------------------------------------------- | ----- |
| 5a    | `src/lib/sync.ts` — snapshot shape and validator, pure        | done  |
| 5b    | D1 binding, `POST`/`GET /api/sync`, abuse caps                | done  |
| 5c    | Sync store: `sync:snapshot`, merge computed, refresh, toggle  | done  |
| 5d    | `curators-journal-runelite`: panel, sync button, hash display | —     |
| 5e    | Plugin Hub submission                                         | —     |
| 5f    | Licensing rewording in CLAUDE.md and NOTICE.md                | —     |

### Open within Phase 5

- **Where does the sync UI live?** Its own panel makes a fifth tab, which trips
  the tab bar's icon-only threshold for every panel. It may belong in About
  alongside export/import, which is where the other account-shaped settings
  already are. Unmeasured either way.
- **What triggers a sync?** On login, on every quest completion, or on a button
  in the plugin panel. Chattiness against freshness, undecided — but the web
  side pulls on session start and on demand regardless, so the plugin can start
  at the conservative end.
- **Quests only, initially.** Diaries and combat achievements are the obvious
  next passengers and are explicitly out of scope here.

### What to sync next, and the rule that decides it

The two contexts this app serves are **temporally disjoint**, and that is the
whole design constraint for anything else the plugin might carry:

- **At the desk**, on RuneLite, is the only time the plugin can capture
  anything. That is the write window.
- **Out with only an iPad or a phone** — no RuneLite, no desktop — is when the
  app gets used. That is the read window, and it is the reason the app exists.

So a snapshot is **always old when it is read**, by hours or days. Which gives
the rule:

> **Sync facts that only ever accumulate.**

Monotonic state ages well: a completed diary is still completed on Friday.
Fluctuating state ages badly, and worse, it is wrong in the direction that
costs something — a Tuesday bank tells you that you have the planks you spent
on Wednesday.

`mergeProgress` already encodes this. Taking the maximum of two states is
**only** correct for data that never goes backwards, so the merge rule and the
staleness rule are the same rule seen twice. It also means the two writers
compose without any conflict resolution: quests finished on mobile get entered
by hand, quests finished at the desk arrive by sync, and additive-max is right
for both without either writer knowing about the other. Keep every future
passenger on this pipe monotonic and that stays true.

**The test for any proposed feature:** does it still answer something useful
three days after it was captured, on a device that cannot see the game?

#### Ranked by that test

1. **Achievement diaries.** Monotonic, miserable to hand-enter, and
   structurally identical to a quest — skill levels plus quest prerequisites —
   so `evaluateQuest` and `buildPlan` need almost nothing new. It is a dataset
   problem, not an engine problem. Give it its own lazy chunk from the start:
   `quests.json` is already the largest asset by a wide margin. **Built, on the
   web side** — see "Diary sync and account-hash linking" below. One thing this
   ranking assumed did not hold: the game exposes a diary only as a per-tier
   done flag, so what syncs is tiers, not tasks.
2. **Unlocks — fairy rings, spirit trees, lunar teleports, ancient scrolls.**
   Permanent, tedious to track, and they gate _travel_, which gates whether a
   quest's start point is actually reachable. Squarely in this app's lane and
   exactly what you cannot remember while planning on a bus.
3. **Collection log, combat achievements, music.** Same category, same pipe,
   lower value — they are completionist records rather than answers to "what
   can I start now".
4. **Drift reporting.** The plugin has to log quest names it cannot match to
   our ids anyway; sending those up makes the dataset self-monitoring, so a
   wiki rename surfaces without anyone remembering to run
   `build:quests -- --check`. Cheap, unglamorous, and it protects the ids that
   quest completions are keyed on.
5. **Multiple accounts.** Nearly free — the row is keyed by account hash, so a
   main and an ironman are two hashes. Mostly a UI question.
6. **Bank contents, reframed.** Fails the freshness test as a readiness check
   and must never render as a checkmark, but it survives as a **prep list**:
   what to buy before the next desk session. The away-job is planning the next
   session, not executing this one. Note that the current caps are quest-sized
   — `MAX_QUEST_ENTRIES` is 400 and the payload `CHECK` is 64 KiB, against a
   bank of 800+ stacks — so this needs its own table rather than the one blob.

#### Rejected, with reasons worth keeping

- **WikiSync's API, as a shortcut past the whole plugin.** `sync.runescape.wiki`
  serves a player's diary tiers (per region, per tier, per task), quest states,
  levels and combat achievements as public JSON keyed by username, and it is
  live — so it appears to make slices 5d and 5e unnecessary for both quests and
  diaries. **We don't get to use it.** RuneScape:WikiSync §Third-party use asks
  third parties not to, on the grounds that players enabled the plugin to share
  data with _the wiki_, not with arbitrary sites, and states they will actively
  limit outside callers. Consent-scoped that narrowly, so there is nothing to
  negotiate and nothing to wait out. Recorded in CLAUDE.md beside the
  third-party source table, because it will look like the answer again.

  Worth keeping for shape, though: WikiSync's payload is close to what our own
  plugin should send — quests as an enum rather than a boolean, diaries nested
  region → tier → tasks, which is exactly the "not a bare top-level map"
  argument the wire format already makes. Arrive at that independently; don't
  copy theirs.

- **Quest step tracking via varbits.** The most expensive thing on the list — a
  per-quest varbit-to-step mapping that is large, undocumented and drifts every
  game update — and it fails the test outright. Away from the desk you are not
  mid-quest at the desk, and anything you do play on mobile the plugin never
  sees.
- **Anything the plugin _renders_.** An in-game overlay of the plan, quest
  arrows, checklists: these make the desktop client better and make the phone
  unnecessary, which is backwards. **The plugin is a sensor, not a surface.**
  Quest Helper already does the other job and does it better.
- **Farming and birdhouse timers.** Genuinely asynchronous and genuinely
  second-screen, but RuneLite's Timetracking already covers it and it has
  nothing to do with a quest journal.

#### One consequence for the UI already built

**"Last synced" is load-bearing, not a footnote.** If every read is of stale
data then the age of that data is part of the answer, and it currently sits in
a muted line under the refresh button. That is probably too quiet.

### Diary sync and account-hash linking

Diary tracking (Phase 6, below) is hand-entered, per task. This puts the
plugin's diary state on the same pipe as quests — ranked first in "What to sync
next" — and adds a way for a player to get their account hash into the app
without typing nineteen digits. The **web and Worker side is done**. The
plugin (5d–5f) does not exist yet, so none of this has met real data.

Slices continue Phase 5's series. They are not "6a–6e": that already means the
diaries feature itself.

| Slice | Contents                                                                                                                                                            | State |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 5g    | Diary tiers on the wire: `lib/sync.ts` validator and `reconcileTiers`; `lib/diaries.ts` `expandTiers` and `mergeDoneTasks`; the Worker stores `{ quests, diaries }` | done  |
| 5h    | Diaries store: `syncedTiers`, merged `done`, drift report, lock guards                                                                                              | done  |
| 5i    | Locked rows for quests and diary tiers; Settings copy, counts and drift                                                                                             | done  |
| 5j    | Link by QR: `isAccountHash`, the `/sync?hash=` route, draft-and-Save field, clipboard paste and copy, copy-first in a tab                                           | done  |
| 5k    | This docs pass                                                                                                                                                      | done  |

Commits, all local and **not yet pushed** when this was written: 5g `1737cca`
`89175f2`; 5h `b69334e`; 5i `ea12779` `3af48d8`; 5j `0586149` `2aa7b94`
`29e8777` `b0c3d54` `c87e7cb`.

**Decisions, and why they aren't obvious from the code:**

- **Tier granularity only.** The backend session found diary state from
  varbits is strictly binary per tier — done or absent — with no per-task or
  count data anywhere. So the wire format is
  `"diaries": { "tiers": ["ardougne-easy", …] }` and carries no tasks. An
  earlier plan to send both tasks and tiers was dropped when that came out.
- **Its own shape, not `QuestProgress`.** A tier is present or absent, like
  `DiaryTaskMap`. A type that could say `doing` would claim visibility the
  plugin doesn't have.
- **Schema stays at version 1.** `diaries` is optional on the wire, and a
  missing key parses as no tiers, so a plugin that predates diaries still
  validates. It is optional on `SyncSnapshot` too, because snapshots cached in
  IndexedDB before this have no such key — read it as `diaries?.tiers ?? []`.
- **The row is fully replaced on every POST.** A quests-only sync clears
  stored diaries rather than keeping stale ones. Safe because the client merge
  is additive; it does mean the plugin must always send both.
- **A synced tier expands to its tasks** (`expandTiers`), so the store keeps
  exactly one hand-entered fact — a task is done — and a synced tier reads as
  done through the same derivation. Merge is a union; `doneTasks` is the only
  thing persisted or backed up, so merge-off is a complete undo.
- **Synced state is locked, not toggleable, and the lock is shown as text.**
  Un-ticking a task the snapshot says is done would edit a local record that
  never held it, leaving the row checked and the tap apparently ignored. The
  store refuses it and the UI disables the control and says why. A note rather
  than a glyph, because the padlock in the diary list already means
  "requirements unmet" and one icon should not carry two meanings.
- **A quest option is locked when the snapshot outranks it** (`isBelowSynced`).
  Equal is left open, so the player can still pin the synced state locally.
  `setProgress` refuses locked states as well as the UI disabling them. Only
  quest detail's three-way picker needed this; the Queue's Start and Finish
  buttons only ever advance a quest, so they cannot hit it.
- **Drift is silent until the dataset loads.** With no index every synced id
  looks unknown, so `syncUnknownTierIds` returns empty rather than accusing
  the plugin. Same trap `SettingsView` documents for quests. Settings therefore
  loads the diaries dataset on open — a lazy chunk, and precached.
- **`/sync?hash=` is a client route, and that is why it needs no spam
  protection.** `run_worker_first` covers only `/api/*`, so the Worker is never
  invoked for it, and `/api/sync` is a different path. The real risk is not
  volume but a crafted link silently replacing the stored hash, so it **never
  applies on load**: it always asks, showing the full hash, and skips the
  prompt only for a hash identical to the one stored. A repeated `hash`
  parameter is refused as ambiguous rather than "take the first". It leaves
  through `router.replace`, because an installed PWA relaunches on the URL it
  was killed holding and a link left in place would re-prompt every launch.
  `isAccountHash` is the single definition of a valid hash, shared with the
  Worker, so the link can't accept something the API then rejects.
- **A scanned code opens Safari, not the installed app.** Tested on an iPad
  with the PWA installed. There is no link from Safari into an iOS home-screen
  app, and a page can only tell whether _it_ is running standalone
  (`display-mode: standalone`), never whether an installed copy exists. So in a
  browser tab the confirm screen leads with **Copy**, demotes Link to "Link
  this browser instead", and shows an oak plaque explaining the app is meant to
  run installed because browsers may clear a site's saved data. The installed
  app keeps the plain Cancel and Link pair. The clipboard is the only bridge
  between the two; that Safari and the PWA keep separate storage is believed
  rather than verified here.
- **The hash field is a draft, written only on Save.** It used to bind
  straight to the store, so every keystroke overwrote the saved value, and a
  slip lost a nineteen-digit number recoverable only from RuneLite. Save is
  enabled once the draft is a valid hash that differs from the saved one;
  clearing is allowed and is how a hash is unlinked. `setAccountHash` drops the
  cached snapshot when the hash changes, since it belongs to the old account,
  and Save refetches. Paste from clipboard fills the draft and never saves, and
  never echoes what it found.

**Open, and not blocking:**

- **Plugin side (`curators-journal-runelite`, 5d).** Maps a tier varbit to a
  fixed tier id like `ardougne-easy`. No task-text hashing is involved — that
  was the original plan and `task-id.ts` no longer claims it.
- **Settings reads zero while merge is off.** The line "N quests and N diary
  tiers synced" counts the merge-gated values, so with the toggle off it says
  0 even when a snapshot is cached — hiding exactly what turning it on would
  give. The fix is to count from the snapshot regardless of the toggle, for
  both. Existing behaviour for quests, extended to tiers; not yet changed.
- **D1 migrations are applied by hand, and nothing does it.** No script and no
  workflow step. A fresh clone's `/api/sync` returns a generic 500 ("Could not
  read the sync store.") until `wrangler d1 migrations apply --local`, now
  documented in CLAUDE.md. Whether production has the table applied is
  unchecked (`migrations list --remote` is read-only). Separately, the route's
  `catch {}` swallows the D1 error, which is why that failure was hard to read
  — log the cause server-side without returning it.
- **Settings' install paragraph is plain text.** The plaque from `/sync` is
  the better treatment and could replace it.
- **Store tests don't exist.** The suite covers `lib` and the Worker only, and
  the config has no `@/` alias or pinia setup. The lock guards and the
  dataset-loaded drift guard are covered by typecheck and by hand in a browser.
  Add harness only if the store logic grows.
- **Fetching is Settings-only.** `quests.ensureReady` doesn't fetch the
  snapshot; the sync store hydrates its cache on first use and only Settings
  calls `ensureLoaded`. Diaries follow the same pattern. Existing behaviour,
  but worth knowing if a cold load into a panel ever shows stale synced state.
- **The precache count moved from 58 to 62 entries** with no new content: the
  `/sync` view made `sync`, `persist` and `api` shared chunks. Recorded in
  CLAUDE.md, with the lesson that the count is a tripwire for a new asset and
  the manifest diff is the real check.

## Phase 6: achievement diaries

Built in slices 6a–6f: the dataset (`scripts/build-diaries.ts` →
`src/data/diaries.json`, 48 tiers and 492 tasks), the engine
(`src/lib/diaries.ts`), the store and the UI. Written up after the fact —
code comments have pointed at this section for a while. The fuller decision
log, dead ends included, is `.memories/2026-09-18/132031_diaries-phase-6.md`;
where it disagrees with this file, this file wins. It still says the plugin
will hash task text, which the varbit finding overturned — see "Diary sync"
above.

**The tier-totals cross-check was the whole game.** A diary page states a
tier's requirements twice: once in `{{DiarySkillStats}}` and once across the
tasks' own cells. Comparing them started at 12 disagreements and converged to
zero, and every one was a parser bug rather than wiki drift — the totals are a
precise oracle for whether task parsing is right, and nothing else would have
caught them, because each produces plausible-looking output. A level is _soft_
(kept as prose, not a requirement) when "or" sits either side of it, when it is
in parentheses, when the bullet says "recommended", or when it is a sub-bullet;
and within one task a repeated skill takes the **minimum**, the opposite of the
tier aggregation, because one task naming a skill twice can only be offering
alternative routes. If the cross-check ever reports disagreements again,
suspect the parser before the wiki.

**Task ids are content-derived** (`src/lib/task-id.ts`): normalise, FNV-1a
32-bit, prefix with the tier id. Positional ids were rejected because the wiki
renumbers tasks when Jagex inserts one, and every completion after the
insertion would shift one place and be silently attributed to the wrong task.
Content-derived ids fail better: a copyedit orphans one completion, which
disappears rather than landing somewhere false. The generator asserts
uniqueness within a tier and **fails the build** on a collision, because two
tasks sharing an id means ticking one ticks the other forever.

**Tier state is derived, not entered.** The only hand-entered fact is "this
task is done"; tier state, counts and `rewardsBlockedBy` all derive from it, and
"mark tier done" writes task completions. Tier progress was originally its own
map, and the tell that it was the wrong shape was that nobody could say what
marking a tier actually did. One record, so nothing can disagree with itself.
An empty tier reads `todo`, never `done`: an empty tier means the dataset
failed to parse one, and calling that complete would hide the defect and credit
work never done.

**Done and doable stay independent.** A checked task keeps its padlock — the
padlock is the wiki's opinion of the requirements, the check is the player's
record of what they did — and a finished task stops counting toward
`blockedTasks`. A boost, a game update or a wiki error all produce that state
legitimately. Diaries never enter `buildPlan`: nothing in the quest graph
depends on one.

**Dead ends worth keeping:**

- **Tier-only tracking**, built first and rejected on sight. A diary is only
  useful as a worklist you run down while playing, which needs per-task checks.
  (Sync is tier-only, but that is a limit of what the game exposes, not a
  design choice: hand entry is per task, sync is per tier.)
- **`plus` for "mark all done".** It already means "add to queue" on quest
  rows. Replaced with the double tick (`checkAll`): single tick is this one,
  double is all of them.
- **A "frozen renderer" that does not exist.** The DevTools screenshot call
  times out on the diary _detail_ view specifically, and its error text
  speculates the renderer may be frozen. It was reported as a diagnosis and was
  wrong — the page was fine. Screenshotting that view is unreliable in this
  setup; the app is not. Do not chase it.

**Settled — placement (6e): a mode inside Quests.** Both variants shipped side
by side for a while; the Diaries panel (`DiariesView.vue`) is deleted and the
segmented mode in `QuestsView.vue` is the one that stays. Judged on the device:
a fifth tab trips the tab bar's icon-only threshold, so _every_ panel loses its
label to buy one tab — too much for a list that is already one tap inside
Quests. Boss tracking wanting a tab of its own made the trade worse still.

The mode now lives in the path rather than in a ref: `/quests` and `/diaries`
are two route records on the same component, both carrying
`meta.panelId: 'quests'`, so the tab bar stays lit on Quests and a PWA killed
in diary mode relaunches in diary mode. Keeping `/diaries` as the diary path
also means an app killed holding the old panel URL still opens where it left
off. Switching modes navigates with `replace`, so toggling doesn't stack
history. `DiaryList.vue` is unchanged — being separate from either view is
what made the swap this small.

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
3. ~~Never tested docked on the device.~~ **Ran on the iPad at 0.3.x.** It
   holds up, and it turned up three things a desktop browser at forced widths
   could never have shown:

   - **iPadOS puts its own window menu over the top-left** in windowed mode,
     which covered the title. The title is centred now — and a left-aligned
     back button in the quest detail view would land under that same menu.
   - **Mobile Safari rubber-bands the document** whatever `overscroll-behavior`
     says. The body background was a darker brown used nowhere else, so a pull
     exposed a colour the app never otherwise shows; it is now the same oak as
     the chrome and the `theme-color`.
   - **Manual refresh has no home in a PWA** — no address bar to pull. Hence
     pull-to-refresh.

   Still unmeasured: the tab bar is ~74px of a docked strip. The Settings panel
   reports live window size, so that number is now obtainable.

4. ~~The automated deploy is unproven.~~ **Closed — it works.** 0.3.0's deploy
   failed and 0.3.1's succeeded once the fix landed, so the CI path is now
   exercised end to end rather than assumed.

   It broke on Node: CI pinned 20 from the original Pages scaffold, while
   wrangler 4.130 and miniflare 5 declare `engines: node >=22`. That floor
   moved _inside_ the existing `^4.112.0` range, so `npm ci` brought it in with
   nothing in the repo changing — and local dev on 22.20 never saw it. **Worth
   generalising:** a caret range can import a new toolchain requirement, so the
   next unexplained CI break is worth checking against `engines` before
   anything else.

   Related correction: **Workers Builds was never connected.** Every deploy is
   GitHub Actions or the CLI. CLAUDE.md and this file both claimed
   git-connected builds; that came from a migration checkpoint recording it as
   an intended next step, and it was never done.

5. ~~No `workflow_dispatch` on the deploy job.~~ **Fixed.** A manual dispatch
   now bypasses the release gate, so a failed deploy is retryable without
   cutting a release — the trap this hit twice.

   **Dispatch against the release _tag_, not `main`.** The dropdown accepts
   either, and the gate exists because the Settings panel advertises
   `__APP_VERSION__` from `package.json`, which only the release PR bumps.
   Deploying `main` manually would ship a build whose version readout is ahead
   of its tag — and that readout is what device measurements rely on.

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

## Phase 7: bosses

A boss list that is **both a tracker and a reference**: kill counts for the 71
bosses Jagex publishes them for, and stats, requirements and drop tables for all
~183 the wiki documents. Started 2026-09-21; 7a–7c are built.

| Slice | Contents                                                                                      | State |
| ----- | --------------------------------------------------------------------------------------------- | ----- |
| 7a    | Tab bar stage 2 by width-per-tab, so a fifth tab doesn't strip every label (`da5b7aa`)        | done  |
| 7b    | `src/lib/bosses.ts`: the join, the three states, sorting, drift report (`47c1196`, `6772e3d`) | done  |
| 7c    | `scripts/build-bosses.ts` → `src/data/bosses.json`, 183 bosses (`a6f79a4`)                    | done  |
| 7d    | The `/bosses` panel: registry entry, store with a dynamic import, the list (`75a4619`)        | done  |
| 7e    | Boss detail view; drops, fight prose and locations → `public/boss-detail/<id>.json`           | done  |
| 7f    | Requirements from the quest-links oracle, **as links to quest detail**; `check:drift`; docs   | next  |
| 7g    | Items: `/items/:id`, GE prices via the banked Worker proxy, "needed for" from `quests.json`   | —     |

**The wiki is the spine and the hiscores decorate it** — the opposite of quests
and diaries, and deliberate. The hiscores publish counts for 71 bosses; the
wiki documents ~173 in `Category:Bosses`. The other ~100 (Akkha, Agrith Naar,
raid rooms, quest bosses) have drops and requirements worth reading and no kill
count that exists **anywhere**.

**That was measured, not assumed** (2026-09-21), because "surely some API has
this" is the obvious next question and deserves a real answer:

| Source         | Bosses | Beyond the hiscores?                                         |
| -------------- | ------ | ------------------------------------------------------------ |
| Jagex hiscores | 71     | —                                                            |
| Wise Old Man   | 71     | none — identical set                                         |
| TempleOSRS     | 86\*   | none — all respellings (`KreeArra`, `Clue_all`, `Vetion`, …) |

\* non-skill keys, which include the clue and minigame rows too. Neither
service carries `Akkha` or `Agrith Naar`. Both are hiscore scrapers: they add
_history_ — gains over time, efficient hours bossed — and not one boss Jagex
doesn't publish. CrystalMathLabs is the same shape and mostly skills.

So the only routes to a count Jagex doesn't publish are our own RuneLite plugin
(Phase 5), or **collectionlog.net**, which takes uploads from a RuneLite plugin
and genuinely does hold counts the hiscores lack. The latter is the same
ethical shape as WikiSync — players install a plugin to share data for one
purpose and a third party helps itself — and it would only cover players using
that one plugin. Read their terms before considering it, and expect the answer
to be no. WikiSync itself publishes exactly this shape and is off limits; see
CLAUDE.md.

**The join needs no hand-maintained mapping table**, which was the objection
that nearly sent this the other way. The wiki already keeps redirects for
almost every spelling the hiscores use (`Kree'Arra` → `Kree'arra`, `Nightmare`
→ `The Nightmare`, `The Royal Titans` → `Royal Titans`), so resolving the
hiscore names through the API _is_ the mapping: 70 of 71 land on a page by
themselves. `Barrows Chests` is the only exception and is the sole entry in
`EXCEPTIONS`. A name that stops resolving becomes a defect rather than a boss
that quietly disappears.

**Decisions, and why they aren't obvious from the code:**

- **Names join, ids never do.** The hiscores' boss block is alphabetical, so
  Jagex inserts new bosses mid-list and renumbers everything after them —
  `Amoxliatl` shifted 68 rows by one. An id-keyed join would put one boss's
  kills against another's name after any release: plausible numbers, wrong
  boss, nothing to notice it by.
- **Three states, not two.** Untracked (no count exists for anyone) /
  tracked-but-unranked (a count exists, this player isn't on the board) /
  ranked (a real number, possibly 0 — the live response returns `rank -1,
score 0` for `Brutus`, `Mad Angel` and `Maggot King`). Rendering any two the
  same way asserts something the hiscores never said.
- **Variants are separate entries sharing a page.** `The Corrupted Gauntlet`
  resolves to `The Gauntlet`, `Tombs of Amascut: Expert Mode` to `Tombs of
Amascut`. They have their own counts and no page of their own, so they carry
  `variantOf` rather than being merged or dropped.
- **Versioned infoboxes are emitted whole.** Vorkath is `{{Multi Infobox}}`
  with `version1 = Post-quest` / `version2 = Dragon Slayer II` and paired
  `combat1`/`combat2`. Picking one silently is the failure mode; both ship and
  the UI names which is which.
- **`OTHER_ACTIVITY_NAMES` is the only hand list left**, and it is subtracted
  rather than matched: anything in the activities array that isn't one of those
  20 rows is treated as a boss and must resolve. So a new boss needs no edit
  anywhere, and a new _non-boss_ row fails loudly instead of joining the list.
- **Kill counts are fetched, not hand-entered** — the "fetched, read-only"
  class alongside skill levels, never the precious one. No merge question
  arises and the freshness constraints are the skills grid's.
- **Drop tables follow the guides precedent.** `{{DropsLine}}` parses cleanly:
  123 files, 2525 rows, 219 KB — another `diaries.json` in weight, so
  `public/boss-detail/`, fetched on demand, not precached. Which drops the player has
  _received_ is collection-log data and needs the plugin.
- **The drops directory is `drops/`, not `bosses/`.** `/bosses/:id` is the
  detail route, and a service-worker runtime rule on `/bosses/` would intercept
  navigations to it. Caught while writing the rule rather than in testing,
  which is luck — app routes and asset paths belong in separate namespaces by
  default.
- **A rarity the wiki computes is left unknown, not half-parsed.** Some are
  templates or parser functions — `{{Brimstone rarity|350}}`, or
  `1/{{#expr:180/(1999/2000*…) round 1}}` — and stripping the template left 34
  rows reading a bare `1/` and 47 reading nothing. A truncated fraction is
  worse than a blank because it looks like a rate, so anything still holding a
  template becomes null and the build reports the count (81). Evaluating them
  would mean modelling `#expr` and guessing at `{{Brimstone rarity}}`'s
  semantics, which is inventing a number and attributing it to the wiki.
- **Variants share their parent's drops file.** They have their own kill counts
  but no page of their own, so the store fetches `variantOf ?? id`. Writing a
  duplicate file per variant would be two copies a later regeneration could
  leave disagreeing.
- **Fight prose yes, `/Strategies` no.** The main page's `== Fight overview ==`
  is 112 of 183 bosses at ~2.6 KB each — the paragraph you want on a second
  screen mid-fight. The `<boss>/Strategies` subpages are 34–47 KB each, ~4 MB
  across the set: gear setups and tables, a guide you read beforehand, and the
  wiki is better at it. Per-fetch either would be fine; what rules the subpages
  out is 4 MB committed to the repo and a weekly drift diff of churning prose.
- **Location comes from two places, and neither is `{{Infobox Monster}}`** —
  which has no such field. `{{Infobox NPC}}` carries one (Vorkath's asleep
  form), and `{{LocLine}}` rows are the locations table most monsters use
  (Cerberus). Reading only infoboxes found 53 of 183; both together find 110,
  and Zulrah genuinely has none. It is a list because the table can hold
  several.
- **Collapsed sections live in the query string**, like the quest walkthrough's
  expansion and for the same reason — this page is open while playing, so it is
  what iOS kills. Closed sections are stored rather than open ones, so a fresh
  boss opens expanded and the URL stays clean. Holding the set only in
  `route.query` loses a toggle when two land in the same tick, because
  `router.replace` doesn't update `route` synchronously; a ref mirrors it.
- **No per-row wiki links on drops.** 2525 rows, each an exit door, on a page
  whose premise is not making the player leave — and on an installed PWA
  leaving can cost the app. One "Read on the wiki" at the bottom is the right
  number. Item links are worth having as _internal_ ones (7g), where the value
  is the join the wiki can't do: what it's worth, and what needs it.
- **Tab count — settled: it gets a tab.** A fifth tab used to flip the whole
  bar to icon-only, which is what made this a question at all. 7a replaced that
  with width-per-tab, so five labels survive on the docked iPad and collapse
  only at the 375px phone floor.

**Dead ends worth keeping:**

- **A hand-written boss list** (`BOSS_NAMES`, 71 strings). It shipped in 7b and
  was deleted in `6772e3d` one slice later, once 7c's dataset made it a second
  list that could disagree with the first. It earned its keep by proving the
  join before the generator existed — but "generated, or a checker that can
  detect staleness" is the standard here, and a bare list is neither.
- **Generating the boss list from the wiki alone.** `Category:Bosses` has 173
  members against the hiscores' 71, and 8 of 21 probed hiscore names don't
  match a wiki page title. Either source alone is wrong; the union is the
  dataset.

**Open — the rank cutoff.** Jagex publishes no count below some threshold, and
we don't know what it is. If a 3-kill Zulrah is simply absent from the response,
then "not ranked" in the UI silently means "somewhere between 0 and the cutoff",
and the copy has to say that rather than implying zero. Unmeasured because the
reference account (Lynx Titan) has no small counts to read — every row is either
a large number or absent. Settle it against an account with a known small kill
count, or by walking the public ranking tables to their last page and reading
the lowest published score.

## Ideas banked for Phase 4

- **Spend freshness where it changes an answer.** Eligibility only flips when a
  level crosses a _requirement boundary_, and the queue is literally a list of
  those boundaries. So refresh eagerly when something is a level away from
  unlocking, lazily otherwise. Most XP gains change nothing on screen.
- **The game notifies level-ups, not us.** So the cost of stale data is low, and
  a prominent manual refresh covers the case where you know something changed.
  Automatic cadence can stay conservative.
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
