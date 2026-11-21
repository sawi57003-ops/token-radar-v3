# Token Radar v3 — radar-4-rank

A token launch radar for make.fun's `token-radar-01`: it reads the sealed
snapshot, fits a rank-first calibration from the snapshot's own live-token
protocols, and ranks every eligible pre-token protocol by an implied launch
value, each with a farm plan.

## Model (radar-4-rank)

`implied = TVL × 10^(b0 + b1·log10(TVL) + category log-ratio)`, where the
category log-ratio is the median log10(market cap / TVL) of that category's
live tokens, shrunk toward the market-wide median with a prior weight of 6,
and the line in log10(TVL) is a ridge fit on the residual. Fitted at run
time from the snapshot; nothing is hardcoded by name.

5-fold cross-validation on the 118 live tokens (computed at run time):
leave-one-out Spearman 0.385, log10 RMSE 0.90 — better on rank and on
magnitude than the v2 OLS model (Spearman 0.345, RMSE 0.93). The v2 OLS
fitted magnitude well but its growth and chain terms were noise for ranking;
v3 drops them, shrinks the thin categories harder, and keeps only the TVL
slope. A repeated 5-fold check agrees (v3 beats v2 in 18 of 20 seeds).

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. The program writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory.

## License

MIT — see `LICENSE`.
