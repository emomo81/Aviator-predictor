#!/usr/bin/env node
/**
 * Renders a readable PNG that mimics a crash-game round screen, using a hand-rolled PNG
 * encoder and a 5x7 bitmap font (no canvas / sharp dependency).
 *
 * The ground-truth multipliers are written into a tEXt chunk so the offline mock extractor
 * can read them back verbatim. That makes the whole pipeline testable with zero API quota:
 *
 *   node server/scripts/make-sample-screenshot.js --rounds 18 --seed 7
 *   curl -F image=@server/data/samples/sample-round.png localhost:4000/api/predict
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

class Canvas {
  constructor(width, height, background = [16, 18, 27]) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      this.pixels[i * 3] = background[0];
      this.pixels[i * 3 + 1] = background[1];
      this.pixels[i * 3 + 2] = background[2];
    }
  }

  set(x, y, rgb) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.pixels[i] = rgb[0];
    this.pixels[i + 1] = rgb[1];
    this.pixels[i + 2] = rgb[2];
  }

  rect(x0, y0, w, h, rgb) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) this.set(x, y, rgb);
    }
  }

  /** Draws text at 5x7 glyphs. Returns the width drawn. */
  text(str, x0, y0, scale = 2, rgb = [235, 238, 245]) {
    let x = x0;
    for (const ch of String(str).toUpperCase()) {
      const glyph = GLYPHS[ch] ?? GLYPHS[' '];
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          if (glyph[row][col] !== '1') continue;
          this.rect(x + col * scale, y0 + row * scale, scale, scale, rgb);
        }
      }
      x += 6 * scale;
    }
    return x - x0 - scale;
  }

  static textWidth(str, scale = 2) {
    return String(str).length * 6 * scale - scale;
  }

  toPng({ textChunks = {} } = {}) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: truecolour RGB
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0; // filter: none
      this.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
    for (const [keyword, value] of Object.entries(textChunks)) {
      const payload = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
      parts.push(chunk('tEXt', payload));
    }
    parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })));
    parts.push(chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(parts);
  }
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

function sampleMultiplier(rand) {
  const u = Math.min(0.999999, rand());
  return Number(Math.max(1, Math.min(200, 0.99 / (1 - u))).toFixed(2));
}

function bucketColor(m) {
  if (m >= 10) return [192, 23, 180];
  if (m >= 2) return [145, 62, 248];
  return [52, 179, 241];
}

function render({ rounds, seed, width = 1024, height = 520, current = null }) {
  const rand = mulberry32(seed);
  // oldest first
  const multipliers = Array.from({ length: rounds }, () => sampleMultiplier(rand));
  const canvas = new Canvas(width, height);

  canvas.rect(0, 0, width, 96, [24, 27, 40]);
  canvas.text('AVIATOR  ROUND  SCREENSHOT', 28, 22, 3, [240, 243, 250]);
  canvas.text('HISTORY  STRIP  BELOW  -  MOST  RECENT  FIRST', 28, 58, 2, [150, 158, 178]);

  // History chips: most recent on the left, like the real UI.
  const chipH = 46;
  let x = 28;
  const y = 130;
  const shown = multipliers.slice().reverse();
  for (let i = 0; i < shown.length; i += 1) {
    const label = `${shown[i].toFixed(2)}x`;
    const chipW = Math.max(78, Canvas.textWidth(label, 2) + 24);
    if (x + chipW > width - 20) break;
    const row = i < 8 ? 0 : 1;
    const cx = row === 0 ? x : x - (width - 40);
    canvas.rect(cx, y + row * 66, chipW, chipH, bucketColor(shown[i]));
    canvas.text(label, cx + 12, y + row * 66 + 14, 2, [255, 255, 255]);
    x += chipW + 12;
  }

  // Live round panel.
  canvas.rect(28, 300, width - 56, 160, [30, 34, 50]);
  if (current) {
    const label = `${current.toFixed(2)}x`;
    canvas.text(label, (width - Canvas.textWidth(label, 8)) / 2, 340, 8, [240, 243, 250]);
    canvas.text('ROUND  IN  PROGRESS', (width - Canvas.textWidth('ROUND  IN  PROGRESS', 2)) / 2, 420, 2, [150, 158, 178]);
  } else {
    const label = 'WAITING  FOR  NEXT  ROUND';
    canvas.text(label, (width - Canvas.textWidth(label, 4)) / 2, 360, 4, [150, 158, 178]);
  }
  canvas.text('14:32', width - 130, 32, 3, [200, 206, 220]);

  return {
    png: canvas.toPng({ textChunks: { Comment: `AVIATOR_GT:${multipliers.join(',')}` } }),
    multipliers,
  };
}

function parseArgs(argv) {
  const args = { rounds: 18, seed: 7, out: 'server/data/samples/sample-round.png', width: 1024, height: 520, current: null };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--rounds': args.rounds = Number(argv[++i]); break;
      case '--seed': args.seed = Number(argv[++i]); break;
      case '--out': args.out = argv[++i]; break;
      case '--width': args.width = Number(argv[++i]); break;
      case '--height': args.height = Number(argv[++i]); break;
      case '--current': args.current = Number(argv[++i]); break;
      default: break;
    }
  }
  return args;
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { png, multipliers } = render(args);
  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath} (${png.length} bytes)`);
  console.log(`Ground truth embedded in the tEXt chunk, oldest first: ${multipliers.join(', ')}`);
}

export { Canvas, render, mulberry32, sampleMultiplier, GLYPHS };
