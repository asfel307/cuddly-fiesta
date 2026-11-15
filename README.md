# Token Radar — a token-launch radar for pre-token protocols

A ranked board of the pre-token protocols most likely to launch a valuable token, built from a
sealed DefiLlama snapshot (758 protocols, as of 2026-11-14). An entry for the make.fun bounty
`token-radar-01`.

## What it does

- **Covers the whole radar, not a capped list.** All 40 watchlist protocols, plus every other
  rankable pre-token protocol in the snapshot — 289 rows in total (the starter ranked 200).
- **Calibrates its own value model on the snapshot.** Each category's multiple is the median
  market-cap/TVL of that category's live-token protocols in the same snapshot; a category with
  fewer than 3 live comparables falls back to the global median (0.2138). Every multiple is
  clamped to [0.02, 2.0]. No protocol name is special-cased.
- **Scores every row with one function of the snapshot figures:**
  `implied = round(tvl_usd x category_multiple x (1 + clamp(change_7d, -60, 120)/100 x 0.5) x (0.6 + min(age_days, 1095)/1095 x 0.4))`
  Age is the time since the protocol was first listed (an unlisted age uses 365 days).
- **Gives every protocol a 7-step farm plan** (setup, a category-specific action, a
  category-specific weekly habit, a hold period, a points check, claim safety, and a farm log),
  each step with a cost and a time, derived from the protocol's own category, chains, TVL and age.
- **Shows the live-token protocols separately**, by market cap, so the market's own values are
  never mixed into the ranking.
- **The dashboard is a static page** (no network, no framework): a sortable/filterable board,
  a per-protocol detail view that recomputes the row's implied value from the same formula and
  shows its farm plan, a live-token view, and a model panel stating the formula.

## Run it

Requires Node.js 22.18+.

```sh
# From the repository root, with the sealed snapshot at ../input/snapshot.json:
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

This writes `out/board.json` (the 289-row board), `out/data.js` (the dashboard's dataset),
`out/dashboard/` (the page), `out/screenshots/` (3 screenshots) and `out/dossier.json`
(the summary the judge reads). The program refuses to write a board the gate would refuse.

## Layout

- `main.ts` — the entry point: reads the snapshot, scores it, writes the output.
- `lib/model.ts` — the model (radar-2): calibration, scoring, farm plans, board checks.
- `dashboard/` — the static page (`index.html`, `app.js`, `app.css`).
- `screenshots/` — the three screenshots (board, detail view, filtered view).
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).
- `LICENSE` — MIT.

## Model notes

The category multiples are medians of live market ratios, so they move with the market: bridges
and privacy protocols trade richly against TVL (multiples 0.56–1.22), while liquid staking and
lending trade thinly (0.04–0.13). The top of the board is therefore dominated by large
pre-token bridges — that is what the snapshot's own figures say, and the dashboard states the
formula and the multiples openly so the ranking can be checked row by row. Implied value is a
model, not a promise: a high implied value does not mean a token will launch, only that the
protocol's scale and category would support one if it did.
