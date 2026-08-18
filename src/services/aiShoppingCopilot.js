import { fetchWithFallback, GeminiRateLimitError } from './gemini';

const RATE_LIMIT_RESULT = {
  verdict: 'Пропустить',
  reasoning: 'Помощник покупок сейчас немного перегружен — попробуйте отсканировать ещё раз через минуту.',
  error: true,
};

function buildPrompt(capsuleScore, styleVibes) {
  const vibesText = styleVibes && styleVibes.length > 0 ? styleVibes.join(', ') : 'no specific aesthetic set';
  return `Analyze this item. Based on the user's existing wardrobe capsule score (${capsuleScore}%) and style vibes (${vibesText}), is this a 'Buy' or 'Pass'? Provide a brief reasoning.

LANGUAGE (ABSOLUTE) — Write both "verdict" and "reasoning" entirely in Russian. This app is Russian-only (see AGENTS.md) and both values are shown directly to the client.

Respond with ONLY a raw, valid JSON object — no markdown formatting, no code fences, no commentary before or after it. Exact shape:
{
  "verdict": "Купить" or "Пропустить" (exactly one of these two strings, nothing else),
  "reasoning": "1-2 sentences in Russian explaining the verdict"
}`;
}

// Snaps a single in-store item and asks Gemini for a quick "Buy or Pass"
// verdict against the client's existing capsule score + chosen style vibes —
// same vision-input shape as aiScanner.js's scanClothingItem, different ask.
export async function analyzeShoppingItem(base64Image, { capsuleScore, styleVibes }) {
  if (!base64Image) {
    throw new Error('No image data to analyze.');
  }

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(capsuleScore, styleVibes) },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  };

  let payload;
  try {
    payload = await fetchWithFallback(requestBody);
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
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

  if (!parsed.verdict || !parsed.reasoning) {
    throw new Error('Gemini response is missing verdict or reasoning.');
  }

  return { verdict: parsed.verdict, reasoning: parsed.reasoning, error: false };
}
