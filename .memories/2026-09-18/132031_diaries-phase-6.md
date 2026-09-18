---
timestamp: 2026-09-18T13:20:31Z
branch: main
commit: b7d5cd6
tags: [diaries, phase-6, task-ids, wiki-parsing, runelite, ui-variants]
summary: Phase 6 achievement diaries — dataset, engine, store, UI; task ids hashed from text as a contract with the future RuneLite plugin
---

Phase 6 built in slices 6a–6f. WikiSync's exclusion is in the 2026-09-17
checkpoint and in CLAUDE.md; not repeated here.

## The cross-check was the whole game

Diary pages state a tier's requirements twice: once in `{{DiarySkillStats}}`
and once across the tasks' own cells. Comparing them started at **12
disagreements and converged to zero**, and every one was a parser bug rather
than wiki drift. The wiki's tier totals turned out to be a precise oracle for
whether task parsing was right — nothing else would have caught these, because
every one produces plausible-looking output:

1. Only the first `{{SCP}}` per bullet matched, so
   `{{SCP|Woodcutting|10}} and {{SCP|Agility|12}}` silently dropped the second.
2. Alternatives read as requirements: `[[Machete]] or {{SCP|Agility|79}}` made
   "cut a teak log" need Agility 79.
3. Parenthesised ironman caveats read as requirements:
   `{{SCP|Farming|23}} (Ironman accounts require {{SCP|Farming|47}})` gated
   everyone at 47.
4. Sibling bullets offering a cheaper route — Hunter 45 bare-handed *or* Hunter
   35 with a butterfly net.

So a level is **soft** (kept as prose, not a requirement) when "or" sits either
side of it, when it is inside parentheses, when the bullet says "recommended",
or when it is a sub-bullet. And within one task a repeated skill takes the
**minimum**, the opposite of the tier aggregation, because one task naming a
skill twice can only be offering alternative routes.

If the cross-check ever reports disagreements again, suspect the parser before
the wiki.

## Task ids: content-derived, and a contract

`src/lib/task-id.ts`. Normalize (lowercase, non-alphanumeric runs to one space,
trim), FNV-1a 32-bit, 8 hex, prefixed with the tier id.

Positional ids were rejected: the wiki renumbers tasks when Jagex inserts one,
and every completion after the insertion point would shift one place and be
**silently attributed to the wrong task**. Content-derived ids fail better — a
copyedit orphans one completion, which disappears rather than lands somewhere
false.

The user's point, which decided it: the RuneLite plugin will read task text
from the game, so if both sides hash the same way the ids match with no mapping
table. That makes this a cross-implementation contract, which is why the
algorithm is plain enough to reimplement in Java from its own comment.

Verified rather than assumed:

```
wiki "Steal a cake from the Ardougne market stalls."
game "Steal a Cake from the Ardougne Market Stalls"
  -> same id
"...market stall."  -> different id
```

Case and trailing punctuation collapse; a real reword does not. All 492 task
texts are unique within their tier, so no collision today — the generator
asserts it anyway and **fails the build** on a collision, because two tasks
sharing an id means ticking one ticks the other forever.

## Tier state is derived, not entered

Originally tier progress was its own hand-entered todo/doing/done map. The user
asked what marking a tier actually *did*, and the honest answer was almost
nothing — it fed the reward gate and a counter, and nothing in the app depends
on a diary. That was the signal the shape was wrong.

Now the only hand-entered fact is "this task is done"; tier state, counts and
`rewardsBlockedBy` all derive from it, and "mark tier done" writes task
completions. One record, so nothing can disagree with itself.

Kept deliberately independent: **done and doable**. A checked task keeps its
padlock — the padlock is the wiki's opinion of the requirements, the check is
the player's record of what they did — and a finished task stops counting
toward `blockedTasks`. A boost, a game update or a wiki error all produce that
state legitimately.

An empty tier reads `todo`, never `done`: an empty tier means the dataset
failed to parse one, and calling that complete would hide the defect *and*
credit work never done.

## Dead ends and false trails

- **Tier-only tracking.** Built first, rejected on sight of it. The diary is
  only useful as a worklist you run down while playing, which needs per-task
  checks.
- **`plus` for "mark all done".** It already means "add to queue" on quest
  rows. Replaced with Phosphor's double tick (`checkAll`), so single tick =
  this one, double = all of them.
- **A "frozen renderer" I reported and that does not exist.** CDP's
  `Page.captureScreenshot` times out on the diary *detail* view specifically —
  the list captures fine — and its error text speculates "the renderer may be
  frozen". I repeated that as a diagnosis; the user opened the page and it was
  fine. **Do not chase this again.** Screenshotting that view is unreliable in
  this setup; the app is not.

## Not done

- **6e placement is undecided.** Both variants ship right now: a Diaries panel
  (which costs *every* tab its label, since five tabs trips the icon-only
  threshold) and a segmented mode inside Quests (whose mode is deliberately not
  in the URL yet). Needs judging docked on the iPad. The loser gets deleted and
  the winner's state wired into the route — for B that means the mode in the
  path, for A a `/diaries/:id` drill-down. `DiaryList.vue` survives either way.
- **The scheduled drift workflow**, agreed but unwritten: weekly, running
  `--check` for both datasets, opening a PR rather than committing, because the
  wiki is world-editable and auto-commit would make it a write path into
  production. Must distinguish "wiki unreachable" (stay green) from "dataset
  stale" (real finding) — `--check` currently exits 1 for both.
- **`quests.json` is 25 pages behind the wiki**, and the `plainText` fix for
  nested templates changes 77 quests' prose on the next `build:quests`. The
  dataset was deliberately left reverted so it did not ride along in unrelated
  commits.
- **`/checkpoint` has a small bug**: `$ARGUMENTS` concatenates directly onto
  "in this session", giving "in this sessionphase 6". Needs a separator.
