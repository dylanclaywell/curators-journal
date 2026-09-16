# Roadmap and open questions

Where the project stands, what's next, and the decisions whose reasoning isn't
obvious from the code. Written so a session with no prior context can pick up
from here.

Conventions and architecture live in [CLAUDE.md](CLAUDE.md). Third-party
licensing lives in [NOTICE.md](NOTICE.md).

## Status

**0.3.1 is deployed** at <https://stagescape.infinitebit.workers.dev>, and the
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
About panel.

The **queue is real** (4e): it leads with what you can start, keeps the ordered
plan and your goals behind a tab switch, and lets you start and finish a quest
without leaving the panel. Curating moved wholesale to the Quests panel in the
process — see 4e below for why the Queue has no "add" button.

**Phase 4 is done** — 4f moved refresh-on-resume from `StatsView` to the shell,
the last slice. The more interesting question now is whether the shell itself
is right — nothing here has been used on a docked iPad yet, and the collapse
thresholds and the bottom tab bar are both unmeasured guesses.

**Phase 5 is planned, not started.** A companion RuneLite plugin syncs quest
state through our own Worker and D1, and the web side merges it into the quest
panel behind a toggle — the first time anything but the player has written to
quest progress, which is why the section below spends most of its words on
keeping the two apart.

## Phases

| Phase                           | State | Notes                                                                        |
| ------------------------------- | ----- | ---------------------------------------------------------------------------- |
| 0 — Scaffold                    | done  | Vue 3 + TS, Tailwind v4, PWA, Workers + Static Assets, CI, release-please    |
| 1 — Shell                       | done  | Panel registry, generated routes, tab bar, About panel                       |
| 2 — Hiscores                    | done  | 2a route + parser · 2b store + persistence · 2c skills grid                  |
| 3 — Quest dataset               | done  | 214 quests committed; `build:quests` fetches · parses · cross-checks · emits |
| 4 — Quest engine and queue      | done  | Engine, detail, queue, reorder (4e′) and refresh-on-resume (4f) all built    |
| 5 — RuneLite sync               | next  | Companion plugin pushes quest state to D1; merged read-only into progress    |
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
no DOM) plus export/import controls in the About panel. Covers exactly the
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
Conventional Commit in this repo — would start versioning StageScape off plugin
commits.

So: **`stagescape-runelite`, separate and public.** What crosses between them is
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
hiscores. A hash is opaque, so one paste from the plugin panel into StageScape
buys spoof-resistance for free. It is an identifier, not a secret: anyone who
has it can read and write that row, and that is accepted.

The endpoint still needs **abuse caps** — a payload size limit, unknown quest
ids rejected before the write, one row per key so a key can't grow. That is
keeping an open POST route from becoming free storage for strangers, not
protecting the player from spoofing.

### D1, and specifically not KV

The storage is one JSON blob per player, which is KV's shape. Pick D1 anyway:
**KV is eventually consistent**, up to ~60s, and the entire interaction is "hit
Sync in RuneLite, hit Refresh in StageScape." A stale read there doesn't read as
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

CLAUDE.md and NOTICE.md both say StageScape reads public hiscores over HTTP and
never touches the game client, so it isn't a third-party client. The plugin runs
_inside_ RuneLite, which Jagex permits, so it isn't one either — but the
sentence as written stops being true of the project as a whole and needs
rewording rather than being left to rot.

Plugin Hub also requires the plugin repo carry its own licence. Apache-2.0 is
fine; most RuneLite plugins are BSD-2.

### Slices

| Slice | Contents                                                     | State |
| ----- | ------------------------------------------------------------ | ----- |
| 5a    | `src/lib/sync.ts` — snapshot shape and validator, pure       | —     |
| 5b    | D1 binding, `POST`/`GET /api/sync`, abuse caps               | —     |
| 5c    | Sync store: `sync:snapshot`, merge computed, refresh, toggle | —     |
| 5d    | `stagescape-runelite`: panel, sync button, hash display      | —     |
| 5e    | Plugin Hub submission                                        | —     |
| 5f    | Licensing rewording in CLAUDE.md and NOTICE.md               | —     |

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

   Still unmeasured: the tab bar is ~74px of a docked strip. The About panel
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
   either, and the gate exists because the About panel advertises
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
