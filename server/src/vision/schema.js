/**
 * The structured extraction contract shared by the Gemini call and the offline mock.
 * Anything the ML layer consumes must exist in this schema.
 */

export const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isCrashGameScreen: {
      type: 'BOOLEAN',
      description: 'True if the screenshot looks like a crash/aviator style game round screen.',
    },
    screenKind: {
      type: 'STRING',
      enum: ['live_round', 'history_list', 'lobby', 'other'],
      description: 'What kind of screen this is.',
    },
    currentMultiplier: {
      type: 'NUMBER',
      nullable: true,
      description: 'The multiplier currently on screen, e.g. 2.47. Null if no live round is visible.',
    },
    state: {
      type: 'STRING',
      enum: ['waiting', 'flying', 'crashed', 'unknown'],
      nullable: true,
    },
    history: {
      type: 'ARRAY',
      description: 'Completed rounds visible on screen, most recent first.',
      items: {
        type: 'OBJECT',
        properties: {
          multiplier: { type: 'NUMBER' },
          confidence: { type: 'NUMBER', nullable: true },
        },
        required: ['multiplier'],
      },
    },
    clock: { type: 'STRING', nullable: true, description: 'Any clock/time text visible, verbatim.' },
    visibleText: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Verbatim UI text you read, in reading order. Cap at 25 items.',
    },
    imageQuality: {
      type: 'STRING',
      enum: ['clear', 'blurry', 'partially_occluded', 'unreadable'],
    },
    notes: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER', description: 'Overall confidence in the extraction, 0..1.' },
  },
  required: ['isCrashGameScreen', 'screenKind', 'history', 'imageQuality', 'confidence'],
};

export const EXTRACTION_PROMPT = `You are an OCR extraction step in a statistics pipeline. Read the screenshot and return JSON only.

Rules:
- Extract every completed-round multiplier you can read (the history strip / recent rounds list). Order them most recent first.
- Report ONLY digits you can actually see. If a value is cut off or unreadable, omit it rather than guessing.
- Do not round, do not "fix" values, and do not infer rounds that are not visible.
- currentMultiplier is the big number for the round in progress; use null if no round is in progress.
- List verbatim UI text you can read in visibleText so a human can audit the extraction.
- Set confidence low if the image is blurry or the numbers are ambiguous.
- Never invent history to look more useful. An empty history array with a low confidence is a correct answer for an unreadable image.`;

export const DEFAULTS = {
  isCrashGameScreen: false,
  screenKind: 'other',
  currentMultiplier: null,
  state: 'unknown',
  history: [],
  clock: null,
  visibleText: [],
  imageQuality: 'unreadable',
  notes: null,
  confidence: 0,
};

/** Coerce whatever the model returned into the shape the rest of the app expects. */
export function normaliseExtraction(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const history = Array.isArray(parsed.history)
    ? parsed.history
        .map((item) => {
          const value = typeof item === 'number' ? item : Number(item?.multiplier);
          if (!Number.isFinite(value) || value < 1) return null;
          return { multiplier: Number(value.toFixed(4)), confidence: Number(item?.confidence ?? 1) };
        })
        .filter(Boolean)
    : [];

  const currentRaw = Number(parsed.currentMultiplier);
  const currentMultiplier = Number.isFinite(currentRaw) && currentRaw >= 1 ? Number(currentRaw.toFixed(4)) : null;

  return {
    isCrashGameScreen: Boolean(parsed.isCrashGameScreen),
    screenKind: ['live_round', 'history_list', 'lobby', 'other'].includes(parsed.screenKind) ? parsed.screenKind : 'other',
    currentMultiplier,
    state: ['waiting', 'flying', 'crashed', 'unknown'].includes(parsed.state) ? parsed.state : 'unknown',
    history,
    clock: typeof parsed.clock === 'string' ? parsed.clock : null,
    visibleText: Array.isArray(parsed.visibleText) ? parsed.visibleText.filter((t) => typeof t === 'string').slice(0, 25) : [],
    imageQuality: ['clear', 'blurry', 'partially_occluded', 'unreadable'].includes(parsed.imageQuality) ? parsed.imageQuality : 'unreadable',
    notes: typeof parsed.notes === 'string' ? parsed.notes : null,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0))),
  };
}

/**
 * Gemini reports the history strip most-recent-first; the feature builder wants
 * chronological order. Returns oldest -> newest.
 */
export function historyToChronological(extraction) {
  const values = (extraction?.history ?? []).map((h) => h.multiplier);
  return values.slice().reverse();
}
