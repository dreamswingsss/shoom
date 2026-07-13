import { fetchWithFallback, GeminiRateLimitError } from './gemini';
import { CATEGORIES } from '../constants/wardrobeOptions';

const CATEGORY_ENUM = CATEGORIES.map((category) => `"${category}"`).join(', ');

const SYSTEM_PROMPT = `You are a Fashion Data Extractor.

Look at the single clothing item shown in the attached photo and extract structured catalog data about it.

Respond with ONLY a raw, valid JSON object — no markdown formatting, no \`\`\`json code fences, no commentary before or after it. The object must have exactly these five keys:
{
  "category": one of ${CATEGORY_ENUM} (must match exactly, no other value is allowed),
  "subcategory": a short, specific garment name, e.g. "T-shirt",
  "color": the primary color of the item, e.g. "Black",
  "style": the item's style register in one or two words, e.g. "Casual", "Formal", "Sport", "Streetwear",
  "description": a short one-sentence description of the item (cut, material impression, notable details)
}`;

const RATE_LIMIT_MESSAGE = 'Servers are a bit overloaded! Please try scanning this item again in a minute.';

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
  if (!parsed.subcategory || !parsed.color) {
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
