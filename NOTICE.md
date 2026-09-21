# Notices and third-party attribution

Copyright 2026 Dylan Claywell

This project's own source code is licensed under the Apache License, Version 2.0
— see [LICENSE](LICENSE). This file covers material that **is not ours**, and
is kept separate from that licence.

## Why this file has to travel with the code

This is the `NOTICE` text file referred to by **Apache-2.0 section 4(d)**: if
you distribute a derivative work, you must include a readable copy of the
attribution notices below.

That is not a formality here, and the reason is easy to miss:

**The repository contains no Jagex assets, but anything built from it does.**
`scripts/fetch-skill-icons.mjs` downloads Jagex's skill icons during
`npm run build`, so every built bundle and every deployed instance — including
a fork's — distributes Jagex artwork to its users. The source is clean; the
output is not.

So the obligation attaches to **the code that does the fetching**, not to the
files in the repo. Consequences for anyone forking, modifying or redistributing
this project:

- You inherit the Fan Content Policy position described below, in full. It is
  not discharged by the upstream repo having complied.
- The §8.1 notice must stay **reachable by end users** of whatever you ship, not
  merely present in a repo file. In this project the Settings panel does that job;
  a derivative work needs its own equivalent.
- Removing `fetch-skill-icons.mjs` — and any `<img>` referencing
  `/skill-icons/` — is what actually removes the obligation. Deleting this file
  does not.

---

## Jagex intellectual property

> Created using intellectual property belonging to Jagex Limited under the terms
> of Jagex's Fan Content Policy. This content is not endorsed by or affiliated
> with Jagex.

That wording is required verbatim, in a prominent place, by
[section 8.1 of the Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy).
It also appears in the app's Settings panel. Do not paraphrase it.

### Skill icons — read this before changing how they are handled

The 24 skill icons are **Jagex's copyrighted interface artwork**. The OSRS Wiki
hosts them and states so plainly on each file page:

> "This is licensed media of a copyrighted video game." … "This media is taken
> from oldschool.runescape.com, and its copyright is held by Jagex Ltd. It is
> used with permission."

**That permission is the wiki's, and does not transfer to us.** The files being
freely downloadable says something about access, not about rights.

Where that leaves us, honestly:

- The Fan Content Policy **does not address** embedding static game assets in a
  third-party application. It is neither permitted nor prohibited — a genuine
  gap, not a loophole we found.
- §2.4 excludes trademarks from the policy entirely. **The Jagex and RuneScape
  logos and wordmarks are never used here**, and must not be.
- §6.1.2 prohibits third-party game _clients_. Curator's Journal reads public hiscores
  over HTTP and never touches the game, so it is not one.
- Using these icons is near-universal practice among OSRS fan tools, and the
  policy is permissive in spirit. For a personal, non-commercial tool carrying
  the §8.1 notice, the practical risk is low. This was a considered decision,
  not an oversight.

Consequences that follow, and that should be preserved:

1. **The icons are not committed to this repository.** `public/skill-icons/` is
   gitignored and repopulated at build time by
   `scripts/fetch-skill-icons.mjs`, so the repo itself redistributes no Jagex
   assets.
2. **Keep it non-commercial.** Monetising the app changes this analysis
   materially, and the icons would need revisiting first.
3. **Don't add more Jagex assets casually** — item sprites, interface chrome,
   map tiles. Each one widens the same gap.

If that trade ever stops looking acceptable, the fallback is drawing 24 original
glyphs on a 16px grid. Substituting generic fantasy icons was tried and rejected:
they are drawn for large display, turn to mush at grid size, and carry none of
the recognition that makes the real icons work.

### Generated datasets — `src/data/*.json`

`quests.json`, `diaries.json` and `bosses.json` are generated from the
[OSRS Wiki](https://oldschool.runescape.wiki), whose text content is licensed
**[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/)**. They
are **parsed and restructured**, not copied verbatim — each carries a `sources`
array naming the pages it was built from, and the generators are in `scripts/`.

**Copyright protects expression, not facts,** so these files engage the licence
unevenly, and it is worth knowing which part of a file is which:

- A skill requirement, a quest prerequisite, a boss's combat level or hitpoints
  is a **fact about the game**. It cannot be copyrighted however it is written
  down, and it would be identical if we had measured it ourselves in-game.
- A quest `description`, a diary task's wording, a `notes` line or a reward
  description is **the wiki's prose**, condensed by its editors.
- Selection and arrangement — which bosses are in a list, in what order — carries
  thin protection of its own, independent of the entries.

So `bosses.json` is mostly facts with short `examine` strings; `quests.json` and
`diaries.json` carry real prose alongside their facts; and `public/guides/*.json`
is prose almost end to end, which is why it has its own section below.

`public/boss-detail/*.json` is split down the middle and worth knowing about:
the drop tables are facts (an item, a quantity, a rate), while the `overview`
field is the wiki's **"Fight overview" prose**, carried across as written. That
half sits with the guides rather than with the datasets, and the same three
letters apply to it at full strength.

**These files are CC BY-NC-SA 3.0. They are not Apache-2.0.** The `LICENSE` at
the root of this repository covers our own source code and does not — cannot —
extend to wiki-derived content: we have no right to relicense someone else's
work under permissive terms. The two licences coexist in one repository the way
the guides and the code do, and for the same reason the boundary is kept
visible: generated data lives in `src/data/` and `public/guides/`, never inlined
into a component.

Practically, for this project and for forks:

- **BY** — every quest, diary and boss entry carries a `wikiUrl`, and the app
  links it. Attribution must reach the reader, not just this file.
- **NC** — a free personal tool is fine. Anything with revenue is not, and this
  is the **stricter of the two reasons not to monetise**: the Jagex position
  below is a judgement about a gap in a policy, whereas this is a licence term
  with a copyright holder behind it.
- **SA** — a derivative of these files stays under CC BY-NC-SA 3.0. Publishing a
  modified `quests.json` under a permissive licence is the failure mode to
  avoid.

Uploading this repository to a public host is redistribution, which the licence
permits on exactly these terms. What it does not permit is redistributing the
data while claiming a licence we don't hold — which is why the split above is
spelled out rather than left to the root `LICENSE` to imply.

#### If running it ever costs money

**The decision is that it stays free, and that includes donations.** Not a
default — a choice, made deliberately, and stricter than the licence strictly
requires: Creative Commons' own guidance is that NC turns on use "primarily
intended for commercial advantage or private monetary compensation", and pure
cost recovery sits in a grey area rather than being plainly barred. The grey
area is not somewhere this project goes.

So if it ever outgrows Cloudflare's free tier, the options are **retire it** or
**ask for explicit permission** — not "take donations and re-read the licence
charitably".

Two things to know before starting that conversation:

1. **Jagex's permission alone would not be enough.** These are two independent
   rights. The Fan Content Policy governs the game IP; CC BY-NC-SA governs the
   wiki's prose that `src/data/` and `public/guides/` are built from. Only
   Weird Gloop can waive the NC term. The alternative is stripping the
   wiki-derived prose and shipping only the facts, which is a real option — it
   is roughly what `bosses.json` already is.
2. **Explicit arrangements have precedent.** RuneLite operates as a sanctioned
   third-party client although §6.1.2 prohibits third-party clients, and the
   OSRS Wiki is Jagex's officially partnered wiki. Both were negotiated
   individually rather than falling out of a published policy. Whether either
   covers revenue is not something this file claims to know.

The architecture already assumes this. `run_worker_first: ["/api/*"]` means
browser navigations never wake the Worker, and the hiscores route caches for
60s, so cost scales with API calls rather than with readers.

### Quest walkthroughs

`public/guides/*.json` is generated by `scripts/build-guides.ts` from the
wiki's `<quest>/Quick guide` pages, and this is the one place where that licence
does real work rather than sitting in the background.

A walkthrough is **authored prose end to end** — somebody's writing, condensed
and sequenced by them — so shipping it is straightforward redistribution rather
than the mixed case above. Everything in the previous section applies, and
applies at full strength: each guide carries the `sourceUrl` of the page it came
from and the app shows it with the walkthrough; the guides stay CC BY-NC-SA 3.0
and do not become Apache-2.0 by living here, just as our code does not become
CC BY-NC-SA by sitting beside them.

It is also why the guides are a separate generated directory rather than being
merged into `quests.json` or inlined into a component. The boundary between our
code and the wiki's prose has to stay something you can point at — the moment a
walkthrough is pasted into a `.vue` file, the two licences are arguing about the
same file.

(An earlier version of this section said `quests.json` "barely engages"
CC BY-NC-SA because requirements are facts. That was true when it held only
requirements, and stopped being true in slice 4g, which added quest
descriptions, notes and rewards. The per-file breakdown above replaces it.)

**For forks:** the same split as the skill icons, from the other direction. The
guides _are_ committed here, so this repository redistributes wiki prose
directly, and a fork does too the moment it clones. Keep this section with
them.

---

## Icons

**[game-icons.net](https://game-icons.net)** — licensed
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), which requires
attribution.

| Icon              | Author      |
| ----------------- | ----------- |
| `scroll-unfurled` | Lorc        |
| `hourglass`       | Lorc        |
| `padlock`         | Lorc        |
| `open-book`       | Lorc        |
| `trophy`          | Lorc        |
| `dragon-head`     | Lorc        |
| `progression`     | Delapouite  |
| `big-gear`        | DarkZaitzev |

**[Phosphor Icons](https://phosphoricons.com)** — licensed MIT. Used:
`chart-bar`, `check`, `checks`, `gear`, `arrow-square-out`, `magnifying-glass`, `plus`,
`caret-down`, `arrows-clockwise`, `pencil-simple`.

Both are vendored into `src/lib/icons.ts` by `scripts/build-icon-set.mjs`.

---

## Typefaces

Both are licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/) and self-hosted from
`public/fonts/`.

- **IM Fell English** — Igino Marini
- **Alegreya Sans** — Juan Pablo del Peral, Huerta Tipográfica
