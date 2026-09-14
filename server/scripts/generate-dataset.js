#!/usr/bin/env node
/**
 * Builds a crash-round dataset in the schema the trainer expects.
 *
 * Drop your own CSV at server/data/dataset.csv instead - the column names are auto-detected
 * (multiplier/crash/value/..., timestamp/time/date/...). This generator exists so the pipeline
 * can be exercised end to end before real data lands.
 *
 * Two regimes:
 *   --regime random   each round is independent (what a provably-fair game actually is).
 *                     The trained model must come out at skill ~0.
 *   --regime markov   injects deliberate autocorrelation (a cold streak raises the odds of a
 *                     big round). The model must find it. This is how you prove the pipeline
 *                     learns when there is something to learn.
 *
 *   node server/scripts/generate-dataset.js --rounds 4000 --regime random
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    rounds: 4000, seed: 11, out: 'server/data/dataset.csv', regime: 'random',
    houseEdge: 0.01, intervalSeconds: 18, start: '2025-01-01T00:00:00.000Z',
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--rounds': args.rounds = Number(argv[++i]); break;
      case '--seed': args.seed = Number(argv[++i]); break;
      case '--out': args.out = argv[++i]; break;
      case '--regime': args.regime = argv[++i]; break;
      case '--house-edge': args.houseEdge = Number(argv[++i]); break;
      case '--interval': args.intervalSeconds = Number(argv[++i]); break;
      case '--start': args.start = argv[++i]; break;
      default: break;
    }
  }
  if (!['random', 'markov'].includes(args.regime)) {
    throw new Error(`--regime must be random or markov, got "${args.regime}"`);
  }
  return args;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard crash distribution: P(X > x) = (1 - houseEdge) / x for x >= 1. */
function crashDraw(rand, payout) {
  const u = Math.min(0.9999999, rand());
  const raw = payout / (1 - u);
  return Number(Math.max(1, Math.min(10000, raw)).toFixed(2));
}

const args = parseArgs(process.argv.slice(2));
const rand = mulberry32(args.seed);
const payout = 1 - args.houseEdge;

const rows = [['round_id', 'timestamp', 'multiplier'].join(',')];
let cursor = new Date(args.start).getTime();
let streakBelow2 = 0;

for (let i = 0; i < args.rounds; i += 1) {
  let multiplier;
  if (args.regime === 'markov') {
    // Deliberate, artificial signal: a cold streak fattens the tail of the next round.
    // Strong on purpose - this regime exists to prove the learner and the evaluator work,
    // which they cannot be shown to do with a signal this size in a few thousand rows.
    const boost = Math.min(0.8, streakBelow2 * 0.22);
    const u = Math.min(0.9999999, rand());
    const shaped = rand() < boost ? payout / (1 - u ** 0.3) : payout / (1 - u);
    multiplier = Number(Math.max(1, Math.min(10000, shaped)).toFixed(2));
  } else {
    multiplier = crashDraw(rand, payout);
  }
  streakBelow2 = multiplier < 2 ? streakBelow2 + 1 : 0;

  rows.push(`${1000 + i},${new Date(cursor).toISOString()},${multiplier.toFixed(2)}`);
  // Round length grows with the multiplier, roughly like the real game.
  cursor += Math.round((6 + Math.min(60, 4 * Math.log(1 + multiplier)) + rand() * 6) * 1000);
}

const outPath = path.resolve(args.out);
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${rows.join('\n')}\n`);

const values = rows.slice(1).map((r) => Number(r.split(',')[2]));
const mean = values.reduce((a, b) => a + b, 0) / values.length;
const over2 = values.filter((v) => v >= 2).length / values.length;
const over10 = values.filter((v) => v >= 10).length / values.length;
console.log(`Wrote ${outPath}`);
console.log(`  regime ${args.regime}  rounds ${values.length}  house edge ${args.houseEdge}`);
console.log(`  mean ${mean.toFixed(3)}x  P(>=2x) ${over2.toFixed(4)}  P(>=10x) ${over10.toFixed(4)}  max ${Math.max(...values).toFixed(2)}x`);
