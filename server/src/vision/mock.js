/**
 * Offline extractor used when no GEMINI_API_KEY is set (or VISION_MOCK=true).
 *
 * It is deterministic: the same image always yields the same history. If the PNG was made by
 * scripts/make-sample-screenshot.js it carries ground truth in a tEXt chunk and the mock reads
 * that back verbatim, which makes the whole image -> features -> prediction path testable
 * without spending API quota.
 *
 * This is a test double, not an OCR engine. It will not read a real screenshot.
 */
import { normaliseExtraction } from './schema.js';

const MARKER = 'AVIATOR_GT:';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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

/** Read ground truth embedded by the screenshot generator, if present. */
function readEmbeddedGroundTruth(buffer) {
  const start = buffer.indexOf(MARKER, 0, 'latin1');
  if (start === -1) return null;
  const slice = buffer.subarray(start + MARKER.length, start + MARKER.length + 2048).toString('latin1');
  const end = slice.search(/[^0-9.,]/);
  const body = end === -1 ? slice : slice.slice(0, end);
  const values = body
    .split(',')
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v) && v >= 1);
  return values.length ? values : null;
}

/** Crash-game shaped sample: heavy tailed, most rounds between 1x and 3x. */
function sampleMultiplier(rand) {
  const u = Math.min(0.999999, rand());
  const raw = 0.99 / (1 - u);
  return Number(Math.max(1, Math.min(200, raw)).toFixed(2));
}

export function mockExtract(base64, options = {}) {
  const buffer = Buffer.from(base64, 'base64');
  const embedded = readEmbeddedGroundTruth(buffer);

  if (embedded) {
    // Generator emits oldest-first; the extraction contract is most-recent-first.
    const history = embedded.slice().reverse().map((multiplier) => ({ multiplier, confidence: 1 }));
    return normaliseExtraction({
      isCrashGameScreen: true,
      screenKind: 'history_list',
      currentMultiplier: options.currentMultiplier ?? null,
      state: 'unknown',
      history,
      clock: null,
      visibleText: ['[mock extractor: ground truth read from PNG tEXt chunk]'],
      imageQuality: 'clear',
      notes: 'Offline mock extractor. Set GEMINI_API_KEY to use real vision.',
      confidence: 0.99,
    });
  }

  const rand = mulberry32(fnv1a(base64.slice(0, 4096)) || 1);
  const count = 12 + Math.floor(rand() * 9);
  const history = Array.from({ length: count }, () => ({
    multiplier: sampleMultiplier(rand),
    confidence: Number((0.6 + rand() * 0.35).toFixed(2)),
  }));

  return normaliseExtraction({
    isCrashGameScreen: true,
    screenKind: 'history_list',
    currentMultiplier: null,
    state: 'unknown',
    history,
    clock: null,
    visibleText: ['[mock extractor: deterministic pseudo-history derived from image hash]'],
    imageQuality: 'clear',
    notes: 'Offline mock extractor - not real OCR. Set GEMINI_API_KEY for real vision.',
    confidence: 0.35,
  });
}
