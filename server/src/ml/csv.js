/** Minimal CSV / JSON dataset reader with column auto-detection. */
import { readFile } from 'node:fs/promises';

const MULTIPLIER_KEYS = ['multiplier', 'crash', 'crashpoint', 'crash_point', 'value', 'odds', 'coefficient', 'payout', 'result', 'x'];
const TIME_KEYS = ['timestamp', 'time', 'date', 'created_at', 'createdat', 'datetime', 'round_time'];
const ID_KEYS = ['round_id', 'roundid', 'id', 'round', 'game_id', 'gameid'];

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return { header: [], rows: [] };

  const splitLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const header = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
  return { header, rows };
}

function findKey(header, candidates) {
  const lower = header.map((h) => String(h).toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx >= 0) return header[idx];
  }
  // fall back to a substring match (e.g. "final_multiplier")
  for (const candidate of candidates) {
    const idx = lower.findIndex((h) => h.includes(candidate));
    if (idx >= 0) return header[idx];
  }
  return null;
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[^\d.eE+-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 1e9) {
    return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000).toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Normalise any supported dataset into chronological rounds.
 * @returns {{rounds: {roundId?:string, timestamp?:string, multiplier:number}[], meta: object}}
 */
export function normaliseDataset(text) {
  const trimmed = text.trim();
  let records = [];
  let header = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    records = Array.isArray(parsed) ? parsed : parsed.rounds ?? parsed.data ?? [];
    header = records.length ? Object.keys(records[0]) : [];
  } else {
    const csv = parseCsv(trimmed);
    header = csv.header;
    records = csv.rows;
  }

  const multiplierKey = findKey(header, MULTIPLIER_KEYS);
  if (!multiplierKey) {
    throw new Error(
      `Could not find a multiplier column. Looked for: ${MULTIPLIER_KEYS.join(', ')}. Columns present: ${header.join(', ')}`,
    );
  }
  const timeKey = findKey(header, TIME_KEYS);
  const idKey = findKey(header, ID_KEYS);

  const rounds = [];
  let skipped = 0;
  for (const record of records) {
    const multiplier = parseNumber(record[multiplierKey]);
    if (!Number.isFinite(multiplier) || multiplier < 1) {
      skipped += 1;
      continue;
    }
    rounds.push({
      roundId: idKey ? String(record[idKey]) : undefined,
      timestamp: timeKey ? parseTimestamp(record[timeKey]) : undefined,
      multiplier: Number(multiplier.toFixed(4)),
    });
  }

  // Sort chronologically when a usable timestamp exists; otherwise trust file order.
  const withTime = rounds.filter((r) => r.timestamp).length;
  if (withTime === rounds.length && rounds.length > 1) {
    rounds.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  return {
    rounds,
    meta: {
      columns: header,
      multiplierKey,
      timeKey,
      idKey,
      skippedRows: skipped,
      sortedByTimestamp: withTime === rounds.length && rounds.length > 1,
    },
  };
}

export async function loadRounds(path) {
  const text = await readFile(path, 'utf8');
  return normaliseDataset(text);
}
