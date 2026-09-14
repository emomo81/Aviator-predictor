/**
 * Gemini vision client: screenshot -> structured round history.
 *
 * Uses @google/genai. The request asks for JSON constrained by EXTRACTION_SCHEMA, and the
 * response is validated by normaliseExtraction() so a hallucinated field can never reach
 * the model as a feature.
 */
import { GoogleGenAI } from '@google/genai';
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA, normaliseExtraction, DEFAULTS } from './schema.js';

export function visionConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
  const models = [
    process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash',
    ...(process.env.GEMINI_MODEL_FALLBACKS?.split(',').map((m) => m.trim()).filter(Boolean) ?? []),
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);
  return {
    apiKey,
    models,
    temperature: Number(process.env.GEMINI_TEMPERATURE ?? 0),
    mock: process.env.VISION_MOCK === 'true' || !apiKey,
  };
}

/** Sniff the image type so callers can POST raw bytes without a content type. */
export function sniffMimeType(base64) {
  const head = Buffer.from(base64.slice(0, 24), 'base64');
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.slice(0, 4).toString('latin1') === 'RIFF') return 'image/webp';
  if (head.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return 'image/png';
}

/** Accepts a data URL, bare base64, or a Buffer. */
export function toInlineData(input, declaredMime) {
  let base64;
  let mimeType = declaredMime;
  if (Buffer.isBuffer(input)) {
    base64 = input.toString('base64');
  } else if (typeof input === 'string') {
    const match = input.match(/^data:([^;]+);base64,(.*)$/s);
    if (match) {
      mimeType = match[1];
      base64 = match[2];
    } else {
      base64 = input;
    }
  } else {
    throw new Error('image must be a data URL, base64 string, or Buffer');
  }
  base64 = base64.replace(/\s+/g, '');
  if (!base64 || base64.length < 64) throw new Error('image payload is empty or too small');
  if (base64.length > 24 * 1024 * 1024) throw new Error('image payload exceeds the 18 MB inline limit');
  return { data: base64, mimeType: mimeType || sniffMimeType(base64) };
}

function parseModelJson(text) {
  if (!text) throw new Error('Gemini returned no text');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Gemini response was not JSON');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * @param {string|Buffer} image
 * @returns {Promise<{extraction: object, meta: object}>}
 */
export async function extractFromImage(image, options = {}) {
  const config = visionConfig();
  const inlineData = toInlineData(image, options.mimeType);

  if (config.mock) {
    const { mockExtract } = await import('./mock.js');
    const extraction = mockExtract(inlineData.data, options);
    return {
      extraction,
      meta: {
        provider: 'mock',
        model: 'offline-mock-extractor',
        reason: config.apiKey ? 'VISION_MOCK=true' : 'GEMINI_API_KEY not set',
        imageBytes: Math.floor((inlineData.data.length * 3) / 4),
        mimeType: inlineData.mimeType,
      },
    };
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const errors = [];

  for (const model of config.models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: EXTRACTION_PROMPT }, { inlineData }],
          },
        ],
        config: {
          temperature: config.temperature,
          responseMimeType: 'application/json',
          responseSchema: EXTRACTION_SCHEMA,
        },
      });

      const extraction = normaliseExtraction(parseModelJson(response.text));
      const usage = response.usageMetadata ?? {};
      return {
        extraction,
        meta: {
          provider: 'gemini',
          model,
          promptTokens: usage.promptTokenCount ?? null,
          outputTokens: usage.candidatesTokenCount ?? null,
          finishReason: response.candidates?.[0]?.finishReason ?? null,
          imageBytes: Math.floor((inlineData.data.length * 3) / 4),
          mimeType: inlineData.mimeType,
        },
      };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
      const retriable = /404|not found|unsupported|PERMISSION_DENIED/i.test(error.message);
      if (!retriable) break;
    }
  }

  throw new Error(`Gemini vision call failed. Tried: ${errors.join(' | ')}`);
}

export { DEFAULTS };
