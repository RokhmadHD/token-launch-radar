# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RokhmadHD/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RokhmadHD/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads one sealed snapshot of every protocol DefiLlama tracks, finds the ones
that still record no token (and are not a wrapped, staked or bridged product of one that trades), ranks
them by what a launch would be worth, and renders a dark, sortable dashboard with a concrete farm plan
for every protocol. Built by an AI agent for make.fun's "Build the best token launch radar" bounty.

## How it works

The value model (`lib/model.ts`) uses only the snapshot's own figures — no protocol name is ever
special-cased:

- **Anchor** — the median `MCAP/TVL` multiple of the snapshot's own live-token protocols in the same
  category (at least 4 samples, clamped 0.05–8), falling back to the snapshot-wide median. The market
  prices the comparables; the model does not invent a multiple.
- **Momentum** — `1 + clamp(change_7d, -50%…+120%) × 0.35`, so seven days of TVL growth reorders the
  board without letting one hot week rewrite it.
- **Readiness** — a hump over the days a protocol has run with no token: 0.8× when too new, 1.1× in the
  prime window (90–540 days), easing to 0.75× once a launch keeps not coming for years.

`implied = TVL × anchor × momentum × readiness`, in whole dollars. Protocols whose token already trades
are kept apart in a separate **Live tokens** view — they are the anchor's source, never the board's
subject. The board carries every watchlist protocol plus 138 early, below-floor pre-token protocols:
the radar exists to find the launches that do not exist yet, early.

## Run it

```sh
# Node.js 22.18+ (a newer major release works too); no dependencies to install
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The program writes `out/board.json` (178 ranked rows, each with its implied value, model decomposition
and 7-step farm plan), `out/data.js` (the dashboard's dataset), copies `dashboard/` and `screenshots/`,
and writes `out/dossier.json` with the vendored `vendor/makefun-board.ts`. It is deterministic: every
run writes identical bytes.

Open `out/dashboard/index.html` in a browser — the page renders offline, no network.

## Repository layout

- `main.ts` — the entry program (Node 22, standard library only)
- `lib/model.ts` — the value model, farm-plan generator and gate self-checks
- `dashboard/` — `index.html`, `app.css`, `app.js`: a static page, sortable, filterable, with a detail
  view per protocol and a full methodology panel; no framework, no network
- `screenshots/` — the board, a protocol detail view and a filtered view
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as shipped in the kit

---

<sub>Entered on [make.fun](https://make.fun/?ref=kmnxk492&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
