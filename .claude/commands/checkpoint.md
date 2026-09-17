---
description: Append a checkpoint to .memories/ — decisions, dead ends, and why
argument-hint: [optional focus, e.g. "the diary parser"]
allowed-tools: Bash(date:*), Bash(git rev-parse:*), Bash(git status:*), Write
---

Today is !`date +%Y-%m-%d`, the time is !`date +%H%M%S`.
Branch !`git rev-parse --abbrev-ref HEAD` at !`git rev-parse --short HEAD`.

Write a checkpoint to `.memories/<date>/<time>_<short-slug>.md` covering the
work in this session$ARGUMENTS. Use this shape:

    ---
    timestamp: <ISO 8601>
    branch: <branch>
    commit: <short sha>
    tags: [<3-6 kebab-case tags>]
    summary: <one line, specific enough to grep for>
    ---

    <body>

The body carries what the repo cannot:

- **Decisions and the reasoning behind them**, especially where the reasoning
  is not visible in the resulting diff.
- **Dead ends, with why they died.** This is the whole point — ROADMAP.md
  records what we chose, and only this records what we rejected and what it
  cost to find out. A dead end recorded here is one nobody walks twice.
- **Verified facts with their evidence** — the query that produced them, the
  endpoint, the response shape. Enough that a future session can re-verify
  without rediscovering how.
- **What is explicitly not done yet**, so an interrupted thread can be picked
  up on another machine.

Do not restate what a `git log` or a diff already says. If a decision belongs
in ROADMAP.md, put it there too — ROADMAP.md is the summary and wins if the
two disagree.

Then remind me to commit it, since it only reaches my other machines if it
lands in git.
