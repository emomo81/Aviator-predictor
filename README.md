# Aviator Predictor

A full-stack pipeline that reads a crash-game screenshot with **Gemini** and feeds the extracted
round history into a **random-forest** machine-learning model, served by a **Node.js** API and a
**Next.js** UI.

> **Honest positioning.** Crash-style games (Aviator and its clones) draw each round from a
> **provably-fair random number generator**. Each round is statistically independent of the rounds
> before it, so no model can predict the next multiplier. This project is a genuinely working
> vision + ML pipeline whose numbers are a *description* of the history you give it, not a forecast.
> It deliberately reports how well it does against a naive base-rate baseline — on random data that
> score sits at ~0, and the UI says so out loud. Treat it as a computer-vision / modelling exercise
> on your own dataset, not a betting tool. See [DISCLAIMER.md](./DISCLAIMER.md).

## Architecture

```
screenshot ─▶ Gemini (structured JSON) ─▶ round history ─┐
                                                        ├─▶ feature vector (31 dims) ─▶ random forest ─▶ prediction
            past rounds (CSV / manual entry) ───────────┘
```

* **`server/`** — Node.js + Express API.
  * `src/vision/gemini.js` — Gemini client (`@google/genai`), JSON-schema constrained extraction.
  * `src/vision/mock.js` — offline extractor used when no `GEMINI_API_KEY` is set (deterministic; reads
    ground truth embedded by the sample generator, so the whole path is testable without quota).
  * `src/ml/forest.js` — dependency-free random forest (CART + bagging + feature subsampling), with a
    sorted-index split search, out-of-bag error, feature importances, and OOB-residual intervals.
  * `src/ml/{features,metrics,csv,modelStore}.js` — shared feature engineering, evaluation vs baseline,
    dataset auto-detection, and model persistence.
  * `src/ml/train.js` — training CLI that writes `server/data/model.json`.
  * `src/pipeline.js` — history → features → ensemble prediction (HTTP-free, unit tested).
* **`web/`** — Next.js (App Router) UI that proxies `/api/*` to the Node server.

## Quick start

```bash
npm install

# 1. Build a demo dataset (or drop your own CSV at server/data/dataset.csv)
npm run generate:dataset -- --rounds 4000 --regime random

# 2. Train
npm run train -- --trees 60 --depth 10 --permutation-check

# 3. Run everything
npm run dev          # API on :4000 + Next.js on :3000
```

Open the live preview (Next.js on port 3000). Without a Gemini key the vision step falls back to the
offline mock; the rest of the pipeline still runs end to end.

### Using real Gemini vision

```bash
cp .env.example .env
# set GEMINI_API_KEY (https://aistudio.google.com/apikey)
```

## Feeding it your own dataset

Drop a CSV at `server/data/dataset.csv`. Columns are auto-detected (multiplier/crash/value/...,
timestamp/time/date/...). Minimum ~50 rounds; more is better. The same feature code path is used for
training (windowed CSV history) and inference (screenshot history), so vectors line up.

## Honest evaluation

`npm run train` prints, for each head, the held-out error **and** the error of the naive baseline plus a
`skill vs base` score that is 0 when the model only matches the base rate.

Two built-in controls prove the pipeline behaves:

* `--regime random` (default) — independent rounds. Expected result: skill ≈ 0, AUC ≈ 0.50, verdict
  "no exploitable signal".
* `--regime markov` — deliberately injects autocorrelation (a cold streak fattens the tail). The model
  then finds it (AUC ≈ 0.58, `streakBelow2` near the top of the importance ranking), which confirms the
  learner and evaluator are correctly wired. Real Aviator data has no such structure.
* `--permutation-check` — shuffles the targets (provably no signal) and confirms the evaluator reports ~0.

## Tests

```bash
npm test   # 29 tests: forest, features, csv, vision (incl. PNG round-trip), pipeline
```
