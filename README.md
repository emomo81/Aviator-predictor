# Aviator Predictor

A dependency-light Node.js training and inference pipeline for analysing crash-game multiplier histories. It builds rolling, lag, streak, and distribution features; trains random-forest regression and classification heads; and evaluates every head against a naive base-rate baseline.

> **Important:** crash games use independent, provably-fair random rounds. A historical model cannot reliably predict the next result. This project reports held-out skill and uncertainty so that noise is not presented as a betting edge.

## Repository data

The model trains from [`multipliers.csv`](./multipliers.csv), the raw chronological sequence of **732,367 rounds**. Its `Multiplier` column is auto-detected by the loader.

`aviator_dataset_clean.csv` is not used as the inference model's input. It omits multipliers at or above 10x and includes same-round derived fields such as `color` (which directly identifies whether its target is at least 2x). Using those columns to predict that same target would introduce target leakage and would not match the rolling history available at inference time.

## Build the model

Node.js 22 is recommended.

```bash
npm --prefix server install
npm --prefix server run train
```

The default command:

- reads `multipliers.csv` regardless of the current working directory;
- preserves chronology and reserves the final 20% as held-out test data;
- engineers each row only from rounds that occurred before its target;
- samples up to 50,000 rows evenly across each partition, covering the complete data span without trying to fit hundreds of thousands of nearly overlapping windows;
- trains a next-multiplier regression forest plus `>=2x` and `>=10x` classifiers; and
- writes the deployable bundle to `server/data/model.json` with the source file's SHA-256 hash and full evaluation report.

Useful options:

```bash
# Rebuild with a different forest size
npm --prefix server run train -- --trees 80 --depth 10 --min-leaf 32

# Remove the row caps (requires substantially more memory and time)
npm --prefix server run train -- --max-train-rows all --max-test-rows all

# Add a shuffled-target sanity check
npm --prefix server run train -- --permutation-check
```

The checked-in model was built with:

```bash
npm --prefix server run train -- \
  --trees 60 --depth 9 --min-leaf 64 \
  --max-train-rows 50000 --max-test-rows 50000 \
  --permutation-check
```

### Held-out result

The final 20% of the chronology was never eligible for training. Evaluation used 50,000 evenly sampled rows from that held-out partition:

| Head | Model metric | Baseline / random reference | Skill vs baseline |
|---|---:|---:|---:|
| log10 multiplier regression | MAE 0.3184 | MAE 0.3182 | -0.0005 |
| next round >=2x | AUC 0.4993 | AUC 0.5000 | -0.0007 (log-loss) |
| next round >=10x | AUC 0.4962 | AUC 0.5000 | -0.0018 (log-loss) |
| shuffled-target check | MAE 0.3186 | — | -0.0013 |

The model found **no out-of-sample predictive signal**. That is the expected result for independent crash-game rounds; the bundle is useful as an honest statistical baseline, not as a betting system. The full machine-readable report is embedded in `server/data/model.json` and exposed by `GET /api/model`.

## Run and use the API

```bash
npm --prefix server start
```

The API listens on `0.0.0.0:4000` by default.

```bash
# Health and model report
curl http://localhost:4000/api/health
curl http://localhost:4000/api/model

# History is most-recent-first by default
curl -X POST http://localhost:4000/api/predict \
  -H 'Content-Type: application/json' \
  -d '{"history":[1.7,8.1,1.4,2.7,1.3,4.5,1.9,1.1,2.2,1.8,12.5,1.05,3.4,1.2]}'
```

At least 12 previous rounds are required. Up to the latest 40 are used. Screenshot analysis uses Gemini when `GEMINI_API_KEY` is configured and a deterministic offline extractor otherwise.

## Tests

```bash
npm --prefix server test
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Render and Supabase deployment options.
