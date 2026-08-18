import { fetchWithFallback, GeminiRateLimitError } from './gemini';
import { CATEGORIES, COLOR_OPTIONS } from '../constants/wardrobeOptions';

const CATEGORY_ENUM = CATEGORIES.map((category) => `"${category}"`).join(', ');
// Same fixed palette ItemDetailScreen/ScanSheet's own color ChipPicker edits
// against (`closet.colors` in ru.json translates each key for display) —
// constraining the model to this enum, the same way "category" already is,
// is what stops it from ever returning a free-text compound description
// like "Серый меланж": that string doesn't match any `closet.colors` key,
// so it rendered untranslated and raw, and colorAgreement.js's gender
// declension (which expects one adjective, not two words) had nothing to
// work with either.
const COLOR_ENUM = COLOR_OPTIONS.map((color) => `"${color}"`).join(', ');

const SYSTEM_PROMPT = `You are a Fashion Data Extractor.

Look at the single clothing item shown in the attached photo and extract structured catalog data about it.

LANGUAGE (ABSOLUTE) — Write "subcategory", "style", and "description" entirely in Russian. This app is Russian-only (see AGENTS.md); these three values are shown directly to the client, unlike "category"/"color" below. Never mix languages within a single value.

Respond with ONLY a raw, valid JSON object — no markdown formatting, no \`\`\`json code fences, no commentary before or after it. The object must have exactly these five keys:
{
  "category": one of ${CATEGORY_ENUM} (must match exactly, in English, no other value is allowed — this is an internal enum, translated for display elsewhere, not shown to the client as-is),
  "subcategory": a short, specific garment name IN RUSSIAN, e.g. "Футболка",
  "color": the closest matching color, one of ${COLOR_ENUM} (must match exactly, in English, no other value is allowed — pick the single nearest basic color even for a heathered/patterned/multi-tone item unless it's genuinely multiple distinct colors with no single dominant one, in which case use "Multicolor" — this is an internal enum, translated for display elsewhere, not shown to the client as-is),
  "style": the item's style register in one or two words IN RUSSIAN, e.g. "Кэжуал", "Классика", "Спорт", "Стритвир",
  "description": a short one-sentence description of the item IN RUSSIAN (cut, material impression, notable details — this is the right place for texture nuance like "меланж"/"в рубчик", not "color")
}`;

const RATE_LIMIT_MESSAGE = 'Серверы сейчас немного перегружены! Попробуйте отсканировать вещь ещё раз через минуту.';

export async function scanClothingItem(base64Image) {
  if (!base64Image) {
    throw new Error('No image data to analyze.');
  }

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Analyze the clothing item in this photo.' },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  };

  let payload;
  try {
    payload = await fetchWithFallback(requestBody, SYSTEM_PROMPT);
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      // Every model in the fallback chain is rate-limited right now —
      // hand back a recognizable result instead of throwing, so the caller
      // can show a toast/alert instead of a crash.
      return { error: true, message: RATE_LIMIT_MESSAGE };
    }
    throw err;
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error('Gemini returned malformed data. Please try again.');
  }

  if (!CATEGORIES.includes(parsed.category)) {
    throw new Error(`Gemini returned an unrecognized category: "${parsed.category}".`);
  }
  if (!COLOR_OPTIONS.includes(parsed.color)) {
    throw new Error(`Gemini returned an unrecognized color: "${parsed.color}".`);
  }
  if (!parsed.subcategory) {
    throw new Error('Gemini response is missing required fields.');
  }

  return {
    category: parsed.category,
    subcategory: parsed.subcategory,
    color: parsed.color,
    // Enrichment fields for the AI stylist prompt — not shown on the confirm
    // screen, so treated as soft/optional: fall back rather than fail the
    // whole scan if Gemini omits one.
    style: parsed.style || '',
    description: parsed.description || '',
  };
}
