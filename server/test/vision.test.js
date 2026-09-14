import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toInlineData, sniffMimeType, visionConfig } from '../src/vision/gemini.js';
import { mockExtract } from '../src/vision/mock.js';
import { normaliseExtraction, historyToChronological } from '../src/vision/schema.js';
import { render } from '../scripts/make-sample-screenshot.js';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test('toInlineData accepts a data URL, bare base64 and a Buffer', () => {
  const fromDataUrl = toInlineData(`data:image/png;base64,${PNG_1x1}`);
  assert.equal(fromDataUrl.mimeType, 'image/png');
  assert.equal(fromDataUrl.data, PNG_1x1);

  const fromBare = toInlineData(PNG_1x1);
  assert.equal(fromBare.mimeType, 'image/png', 'mime type should be sniffed from the PNG magic bytes');
  assert.equal(fromBare.data, PNG_1x1);

  const fromBuffer = toInlineData(Buffer.from(PNG_1x1, 'base64'));
  assert.equal(fromBuffer.mimeType, 'image/png');
});

test('toInlineData rejects empty or absurd payloads', () => {
  assert.throws(() => toInlineData(''), /empty or too small/);
  assert.throws(() => toInlineData(42), /data URL, base64 string, or Buffer/);
});

test('sniffMimeType recognises jpeg and png', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
  assert.equal(sniffMimeType(jpeg), 'image/jpeg');
  assert.equal(sniffMimeType(PNG_1x1), 'image/png');
});

test('vision falls back to the mock provider when no API key is configured', () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const config = visionConfig();
  assert.equal(config.mock, true);
  assert.ok(config.models.length >= 1, 'a default model id must always be present');
  if (previous === undefined) return;
  process.env.GEMINI_API_KEY = previous;
});

test('mock extractor reads ground truth embedded in the PNG and flips it to most-recent-first', () => {
  const { png, multipliers } = render({ rounds: 16, seed: 5 });
  const extraction = mockExtract(png.toString('base64'));

  assert.equal(extraction.isCrashGameScreen, true);
  assert.ok(extraction.confidence > 0.9);
  assert.deepEqual(
    extraction.history.map((h) => h.multiplier),
    multipliers.slice().reverse(),
    'extraction contract is most-recent-first, generator emits oldest-first',
  );
});

test('mock extractor is deterministic for the same image', () => {
  const { png } = render({ rounds: 12, seed: 9 });
  const base64 = png.toString('base64');
  assert.deepEqual(mockExtract(base64).history, mockExtract(base64).history);
});

test('mock extractor degrades gracefully on an image it cannot read', () => {
  const extraction = mockExtract(PNG_1x1);
  assert.ok(extraction.history.length > 0, 'falls back to a deterministic pseudo-history');
  assert.ok(extraction.confidence < 0.5, 'and flags low confidence when it is guessing');
  assert.match(extraction.notes ?? '', /mock/i);
});

test('historyToChronological returns oldest-first for the feature builder', () => {
  const extraction = normaliseExtraction({ history: [{ multiplier: 5 }, { multiplier: 3 }, { multiplier: 1.2 }] });
  assert.deepEqual(historyToChronological(extraction), [1.2, 3, 5]);
});

test('normaliseExtraction rejects junk and clamps confidence', () => {
  const cleaned = normaliseExtraction({
    isCrashGameScreen: 'yes',
    screenKind: 'banana',
    history: [{ multiplier: 1.5 }, { multiplier: 0.2 }, { multiplier: 'nope' }, 4.5],
    confidence: 5,
    visibleText: ['ok', 42, null],
  });
  assert.equal(cleaned.screenKind, 'other', 'unknown enum value falls back');
  assert.deepEqual(cleaned.history.map((h) => h.multiplier), [1.5, 4.5], 'sub-1x and non-numeric values are dropped');
  assert.equal(cleaned.confidence, 1, 'confidence is clamped to 0..1');
  assert.deepEqual(cleaned.visibleText, ['ok']);
});

test('the rendered sample screenshot is a valid PNG', () => {
  const { png } = render({ rounds: 10, seed: 2 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('latin1'), 'IEND');
});
