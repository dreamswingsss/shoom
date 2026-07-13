import { fetchWithFallback, GeminiRateLimitError } from './gemini';
import { CATEGORIES } from '../constants/wardrobeOptions';

function describeProfile({ gender, hairColor, eyeColor, bodyShape } = {}) {
  return [
    `Gender: ${gender || 'not specified'}`,
    `Hair color: ${hairColor || 'not specified'}`,
    `Eye color: ${eyeColor || 'not specified'}`,
    `Body shape: ${bodyShape || 'not specified'}`,
  ].join('\n');
}

function describeWardrobe(wardrobe) {
  return wardrobe
    .map(
      (item, i) =>
        `${i + 1}. id: "${item.id}", category: "${item.category}", subcategory: "${item.subcategory}", color: "${item.color}"`
    )
    .join('\n');
}

function buildSystemInstruction(userProfile, wardrobe) {
  return `You are a High-end Celebrity Fashion Stylist, trusted by top editorial clients for your precise, expert eye. You style real people using only the clothes they already own — never inventing items that aren't in their closet.

CLIENT PROFILE:
${describeProfile(userProfile)}

CLIENT'S WARDROBE (only use items from this exact list — do not invent or substitute items):
${describeWardrobe(wardrobe)}

YOUR PROCESS (follow strictly, in order):
1. Determine the client's Color Season (e.g. "Deep Autumn", "Cool Winter", "Soft Summer", "Light Spring") based on their hair color and eye color. Explain the season briefly.
2. Determine the styling rules that flatter their Body Shape — proportion, silhouette, and fit guidance specific to that shape.
3. Using ONLY the items listed in the wardrobe above, assemble complete outfit combinations that best satisfy both the color season and the body shape rules. Every item you reference in an outfit must exist in the wardrobe list, matched by category and color. Do not fabricate items that are not present.
4. Build as many distinct, genuinely different outfits as the wardrobe reasonably supports (typically 2-4). If the wardrobe is too limited for a full outfit, do your best with what's available and note the limitation in "styling_rules".

Respond with ONLY a raw, valid JSON object — no markdown formatting, no \`\`\`json code fences, no commentary before or after it. The object must have exactly this structure:
{
  "color_season": "the client's color season and a 1-2 sentence explanation",
  "styling_rules": "1-3 sentences on the proportion/fit rules for their body shape",
  "outfits": [
    {
      "outfit_name": "short evocative name for the look",
      "items": [
        { "category": "Tops", "color": "Black" }
      ],
      "reasoning": "1-2 sentences on why this specific combination works for their body shape and color season"
    }
  ]
}`;
}

const RATE_LIMIT_RESULT = {
  error: true,
  message: "Your stylist is a bit overloaded right now — try again in a minute.",
  color_season: '',
  styling_rules: '',
  outfits: [],
};

function validateResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini response is not a valid object.');
  }
  if (!parsed.color_season || !parsed.styling_rules) {
    throw new Error('Gemini response is missing color_season or styling_rules.');
  }
  if (!Array.isArray(parsed.outfits) || parsed.outfits.length === 0) {
    throw new Error('Gemini did not return any outfits.');
  }

  for (const outfit of parsed.outfits) {
    if (!outfit.outfit_name || !Array.isArray(outfit.items) || outfit.items.length === 0) {
      throw new Error('Gemini returned a malformed outfit entry.');
    }
    for (const item of outfit.items) {
      if (!item.category || !item.color) {
        throw new Error('Gemini returned an outfit item missing category or color.');
      }
      if (!CATEGORIES.includes(item.category)) {
        throw new Error(`Gemini returned an unrecognized category: "${item.category}".`);
      }
    }
  }

  return {
    error: false,
    color_season: parsed.color_season,
    styling_rules: parsed.styling_rules,
    outfits: parsed.outfits.map((outfit) => ({
      outfit_name: outfit.outfit_name,
      items: outfit.items.map((item) => ({ category: item.category, color: item.color })),
      reasoning: outfit.reasoning || '',
    })),
  };
}

export async function generateOutfits(userProfile, wardrobe) {
  if (!Array.isArray(wardrobe) || wardrobe.length < 2) {
    throw new Error('Add more items to your closet to unlock AI styling.');
  }

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: 'Generate my outfit recommendations now.' }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.6,
    },
  };

  let payload;
  try {
    payload = await fetchWithFallback(requestBody, buildSystemInstruction(userProfile, wardrobe));
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      // Every model in the fallback chain is rate-limited right now — hand
      // back an empty outfit list with an error flag instead of throwing,
      // so the UI can show a friendly "stylist is overloaded" placeholder.
      return RATE_LIMIT_RESULT;
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

  return validateResult(parsed);
}
