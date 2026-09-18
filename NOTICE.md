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

### Quest and skill data

Sourced from the [OSRS Wiki](https://oldschool.runescape.wiki), whose text
content is licensed **CC BY-NC-SA 3.0**.

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
| `progression`     | Delapouite  |
| `big-gear`        | DarkZaitzev |

**[Phosphor Icons](https://phosphoricons.com)** — licensed MIT. Used:
`chart-bar`, `check`, `gear`, `arrow-square-out`, `magnifying-glass`, `plus`,
`caret-down`, `arrows-clockwise`, `pencil-simple`.

Both are vendored into `src/lib/icons.ts` by `scripts/build-icon-set.mjs`.

---

## Typefaces

Both are licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/) and self-hosted from
`public/fonts/`.

- **IM Fell English** — Igino Marini
- **Alegreya Sans** — Juan Pablo del Peral, Huerta Tipográfica
