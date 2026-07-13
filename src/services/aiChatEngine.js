import { useUserStore } from '../store/useUserStore';
import { fetchWithFallback, GeminiRateLimitError } from './gemini';

const RATE_LIMIT_APOLOGY =
  "Whew, we're swamped with clients today! Give me one minute to catch my breath, and I'll have your outfit ready.";

const UNSPLASH_ACCESS_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY;
const UNSPLASH_SEARCH_ENDPOINT = 'https://api.unsplash.com/search/photos';

function describeProfile(profile = {}) {
  const {
    gender,
    hairColor,
    eyeColor,
    skinTone,
    bodyType,
    height,
    weight,
    measurements = {},
    stylePreferences,
  } = profile;

  const measurementsLine =
    [
      measurements.shoulders != null && `shoulders ${measurements.shoulders}cm`,
      measurements.chest != null && `chest ${measurements.chest}cm`,
      measurements.waist != null && `waist ${measurements.waist}cm`,
      measurements.hips != null && `hips ${measurements.hips}cm`,
    ]
      .filter(Boolean)
      .join(', ') || 'not specified';

  return [
    `Gender: ${gender || 'not specified'}`,
    `Hair color: ${hairColor || 'not specified'}`,
    `Eye color: ${eyeColor || 'not specified'}`,
    `Skin tone: ${skinTone || 'not specified'}`,
    `Body shape: ${bodyType || 'not specified'}`,
    `Height: ${height != null ? `${height}cm` : 'not specified'}`,
    `Weight: ${weight != null ? `${weight}kg` : 'not specified'}`,
    `Body measurements: ${measurementsLine}`,
    `Style preferences (client's own words): ${stylePreferences?.trim() ? `"${stylePreferences.trim()}"` : 'not specified'}`,
  ].join('\n');
}

function describeWardrobe(wardrobe) {
  if (!wardrobe || wardrobe.length === 0) {
    return '(empty — the client has not added any items to their closet yet)';
  }
  return wardrobe
    .map((item) => {
      const base = `- id: "${item.id}" | category: "${item.category}" | subcategory: "${item.subcategory}" | color: "${item.color}"`;
      const style = item.style ? ` | style: "${item.style}"` : '';
      // Older items scanned before style/description existed simply omit these.
      const description = item.description ? ` | description: "${item.description}"` : '';
      return base + style + description;
    })
    .join('\n');
}

function describeStyleVibes(styleVibes) {
  return styleVibes && styleVibes.length > 0 ? styleVibes.join(', ') : 'none specified';
}

function describeWeather(weather) {
  if (weather?.status !== 'ready') return 'not available';
  const place = weather.city ? ` in ${weather.city}` : '';
  return `${weather.temperature}°C, ${weather.condition}${place}`;
}

function buildSystemPrompt(profile, wardrobe) {
  return `You are a high-end personal fashion stylist chatting one-on-one with a client. Terse, decisive, expert — not a chatbot, not a hype machine.

CLIENT PROFILE (use this to judge color-type / skin-hair-eye contrast / body-shape fit as styling knowledge — never dump these raw field values back at the client verbatim):
${describeProfile(profile)}

CLIENT'S EXISTING WARDROBE (reference these by "id" in "suggested_outfit_ids" when you use them; never invent an id that isn't in this exact list):
${describeWardrobe(wardrobe)}

HARD RULES — these override normal conversational instinct whenever they conflict with it:

RULE #1 — Style Preferences Constraint. The client's stated style preferences above are non-negotiable, not a soft hint. If they've said they dislike, avoid, or "hate" a category, fit, or color (e.g. "hate oversized clothes"), NEVER put anything matching that in "suggested_outfit_ids" or "new_items_to_buy" — no matter what the occasion or the rest of this prompt might otherwise call for. If nothing in the wardrobe satisfies both the request and this constraint, say so honestly rather than violating it.

RULE #2 — Tone of Voice (Zero Fluff). No opener, no throat-clearing, no enthusiasm. Banned words/phrases anywhere in "text_response": "Absolutely", "Sure", "Great question", "I've put together", "Here is your look", "I'd love to", or any other greeting/hype filler — this list is illustrative, not exhaustive; the bar is that a client should never be able to find a sentence that isn't doing real styling work. Maximum 2-3 sentences total. Open directly with the outfit/verdict itself.

RULE #3 — Brand Specificity. Anything you put in "new_items_to_buy" must be a real, specific brand + model, never a generic description. "Black combat boots" is forbidden; "Dr. Martens 1460" is correct. Same standard for anything you mention inline in "text_response": say "Nike Air Force 1", "Rick Owens Ramones", "Balenciaga Track", not "white sneakers" or "chunky trainers".

RULE #4 — Actionable Links. Every time "new_items_to_buy" is non-empty, "text_response" must end with one Markdown search link per new item, on its own line, in exactly this format:
[Search: Brand Model](https://www.google.com/search?q=buy+Brand+Model)
— with spaces in the query replaced by "+". Do not add this link for items already in the wardrobe.

RULE #5 — Color Matching. Cross-check any requested colors against the client's hair/eye/skin contrast (their color type). If what they're asking for objectively clashes with their coloring, say so in one clause and pivot straight to the compromise — no lengthy explanation.

RULE #6 — Wardrobe First. Prefer pieces the client already owns when those genuinely achieve the look (reference by real "id" in "suggested_outfit_ids"). Only use "new_items_to_buy" when the look genuinely requires something missing from their closet.

RULE #7 — Only put an item's id in "suggested_outfit_ids" if it's a real id from the wardrobe list above.

RULE: COLOR HARMONY: You must strictly analyze the user's Skin Tone, Eye Color, and Hair Color. Recommend clothing colors that complement these physical traits. Avoid colors that wash the user out. Whenever color is central to a recommendation, justify it in exactly one clause inline in "text_response" (e.g. "Forest green pulls out the green in your eyes" or "Charcoal reads cleaner than black against your skin tone") — never more than one sentence of color reasoning per turn.

RULE: BODY GEOMETRY: Analyze the user's height, weight, and body measurements. Suggest cuts and fits that flatter these specific proportions — treat shoulders/chest/waist/hips as proportion data, not just numbers to acknowledge (e.g. broader shoulders vs narrower hips, longer torso vs shorter legs). This governs fit and cut the same way Rule #1 governs category and color exclusions.

AESTHETIC PREFERENCES: The user prefers the following fashion aesthetics: ${describeStyleVibes(profile.styleVibes)}.
RULE 1 (ABSOLUTE): Body geometry and fit take precedence over aesthetic accuracy.
RULE 2: When building the outfit, infuse the vibe of the chosen aesthetics using the available wardrobe items, adapting them intelligently to flatter the user's body shape.

RULE: STYLE PREFERENCES: The user's style preferences are ABSOLUTE. If they prefer "cropped", "oversized", or "vintage", you MUST build outfits around these exact preferences, adapting them to their body geometry — never substitute a safer generic alternative (e.g. the right crop-top length for a 180cm frame is not the right crop-top length for a 160cm frame).

RULE: SHOPPING LINKS: When recommending specific clothing items or brands, provide real or highly relevant brand links using Markdown format: [Brand Name](https://link.com). This applies anywhere in "text_response" you name a specific piece, not only in the Rule #4 trailing list — link to the brand's real product/site when you know it, and fall back to the Rule #4 Google-search format only when you don't.

RULE: MANDATORY OUTFIT ARCHITECTURE. Every single outfit you generate MUST contain at least three layers: Top, Bottom (pants/jeans/skirt/shorts), and Shoes. Never return a partial outfit (e.g. only a top and shoes, with no bottom). If the client's wardrobe above lacks a matching Bottom or Top to complete the look, you MUST add the missing piece to "new_items_to_buy" (following Rule #3's brand-specificity standard) so the outfit is 100% complete — never leave a layer out just because nothing in the wardrobe fits it.

For "new_items_to_buy", always provide the "name" (e.g. "Dr. Martens 1460"), a valid "url" (e.g. a Google search link for the product), and attempt to provide a stable, generic "image_url" if possible — a real product-photo URL you're confident resolves, not a guessed or placeholder one. Leave "image_url" out entirely if you're not confident in a specific URL; never fabricate one just to fill the field.

Respond with ONLY a raw, valid JSON object — no markdown fences, no text outside the JSON (the Markdown link from Rule #4 goes inside the "text_response" string, not outside it). Exact shape:
{
  "text_response": "terse reply, ends with Rule #4 links if any new items were recommended",
  "suggested_outfit_ids": ["<wardrobe item id>", "..."],
  "new_items_to_buy": [{"name": "Dr. Martens 1460", "search_query": "dr martens 1460", "url": "https://www.google.com/search?q=buy+dr+martens+1460", "image_url": "https://..."}]
}
"search_query" is separate from "url" — it's a short 2-4 word query used internally as a fallback image search, not shown to the client. "url" is what the client actually taps to buy the item, so it must always be present and valid; "image_url" is best-effort and may be omitted.
"suggested_outfit_ids" and "new_items_to_buy" must be "[]" when there's nothing to recommend of that kind this turn.`;
}

function buildContents(message, profile, wardrobe, history) {
  const contents = [
    {
      role: 'user',
      parts: [{ text: buildSystemPrompt(profile, wardrobe) }],
    },
    {
      role: 'model',
      parts: [
        {
          text: JSON.stringify({
            text_response: 'Profile and wardrobe loaded. What are we styling?',
            suggested_outfit_ids: [],
            new_items_to_buy: [],
          }),
        },
      ],
    },
  ];

  history.forEach((turn) => {
    if (turn.sender === 'ai') {
      contents.push({
        role: 'model',
        parts: [
          {
            text: JSON.stringify({
              text_response: turn.text,
              suggested_outfit_ids: turn.outfitIds || [],
              new_items_to_buy: (turn.newItems || []).map((item) => ({
                name: item.name,
                search_query: item.searchQuery,
                url: item.buyUrl,
                image_url: item.imageUrl,
              })),
            }),
          },
        ],
      });
    } else {
      contents.push({ role: 'user', parts: [{ text: turn.text }] });
    }
  });

  contents.push({ role: 'user', parts: [{ text: message }] });

  return contents;
}

// "Zero-Closet" path — used instead of buildSystemPrompt/buildContents when
// the client has 0 wardrobe items. There's nothing to build an outfit FROM
// yet, so instead of styling advice this asks Gemini for a shopping-focused
// "Inspiration Board": a small capsule of specific, buyable pieces reasoned
// purely from the client's physical profile (skin tone / body shape / hair
// color), each with an explicit one-clause "why this suits you".
function buildInspirationSystemPrompt(profile, weather) {
  return `The user has no items in their digital closet. Act as a personal shopper: create an inspiration outfit based exclusively on their Fit Profile (Skin Tone, Body Shape, Hair Color, etc.) and current weather — you cannot reference an existing closet, every recommendation is a shopping reference to help them start one.

CLIENT PROFILE (the only signal you have — use it to reason about color-type / skin-hair-eye contrast / body-shape fit, never dump raw field values back at the client verbatim):
${describeProfile(profile)}

CURRENT WEATHER: ${describeWeather(weather)}

TASK: Curate a 4-6 item "Inspiration Board" — a starter capsule reasoned from their Skin Tone, Body Shape, and Hair Color (and eye color / style preferences when given), appropriate for the weather above. Cover a mix of layers (tops, bottoms, outerwear, shoes, or an accessory) — not five variations of one category.

HARD RULES:
RULE #1 — Every item's "reason" must tie explicitly to a physical trait from the profile above in one clause (e.g. "Camel warms up fair skin without overwhelming it", "A high-rise straight leg balances an inverted-triangle frame"). Never a generic reason like "this looks great" or "versatile piece".
RULE #2 — Brand Specificity. "name" must be a real brand + model, never generic ("Uniqlo U Crew Neck Tee", not "white t-shirt").
RULE #3 — Tone of Voice (Zero Fluff). No greeting, no "Welcome!", no hype. "text_response" is 1-2 sentences max, introducing the board and naming the overall coloring/shape logic behind it.
RULE #4 — Style Preferences Constraint. If style preferences are stated, they're non-negotiable — never suggest a category/fit they've said they dislike.
RULE #5 — Weather Fit. When the weather above is available, at least one item must be justified partly by it (e.g. a layer for cold, breathable fabric for heat) — skip this if weather is "not available" rather than guessing.

Respond with ONLY raw, valid JSON — no markdown fences, no text outside the JSON. Exact shape:
{
  "text_response": "short intro naming the coloring/shape logic",
  "board_items": [{"name": "Brand Model", "reason": "one clause tied to a physical trait", "search_query": "brand model", "url": "https://www.google.com/search?q=buy+brand+model", "image_url": "https://..."}]
}
"url" must always be present and valid. "image_url" is best-effort — omit it entirely rather than guessing.`;
}

function buildInspirationContents(message, profile, weather, history) {
  const contents = [
    {
      role: 'user',
      parts: [{ text: buildInspirationSystemPrompt(profile, weather) }],
    },
    {
      role: 'model',
      parts: [
        {
          text: JSON.stringify({
            text_response: 'Profile loaded. Building your inspiration board.',
            board_items: [],
          }),
        },
      ],
    },
  ];

  history.forEach((turn) => {
    if (turn.sender === 'ai') {
      contents.push({
        role: 'model',
        parts: [
          {
            text: JSON.stringify({
              text_response: turn.text,
              board_items: (turn.boardItems || []).map((item) => ({
                name: item.name,
                reason: item.reason,
                url: item.buyUrl,
                image_url: item.imageUrl,
              })),
            }),
          },
        ],
      });
    } else {
      contents.push({ role: 'user', parts: [{ text: turn.text }] });
    }
  });

  contents.push({ role: 'user', parts: [{ text: message }] });

  return contents;
}

// Guards against trusting a non-string, empty, or non-http(s) value from
// Gemini (a malformed field, or an exotic scheme like "javascript:") as a
// real link or image source.
function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

// Same format as the Rule #4 Markdown link the model is instructed to
// produce inline — kept in one place so the buy-item card and the inline
// text link never disagree.
function buildBuySearchUrl(name) {
  const query = `buy ${name}`.trim().replace(/\s+/g, '+');
  return `https://www.google.com/search?q=${query}`;
}

const UNSPLASH_TIMEOUT_MS = 8000;

// Looks up a representative product photo for a suggested item that isn't in
// the user's wardrobe. Degrades to `null` (never throws) if no Unsplash key
// is configured yet, the request fails, or it hangs — the UI falls back to
// an icon placeholder in that case rather than a broken/guessed image.
export async function fetchImageFromUnsplash(query) {
  const trimmedQuery = query?.trim();
  if (!UNSPLASH_ACCESS_KEY || !trimmedQuery) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UNSPLASH_TIMEOUT_MS);

  try {
    const url = `${UNSPLASH_SEARCH_ENDPOINT}?query=${encodeURIComponent(trimmedQuery)}&per_page=1&orientation=squarish`;
    const response = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (__DEV__) {
        console.warn(
          `[aiChatEngine] Unsplash request failed (${response.status}) for query "${trimmedQuery}".` +
            (response.status === 401 ? ' Check EXPO_PUBLIC_UNSPLASH_ACCESS_KEY.' : '') +
            (response.status === 403 ? ' Likely hit the 50 req/hour demo rate limit.' : '')
        );
      }
      return null;
    }

    const payload = await response.json().catch(() => null);
    return payload?.results?.[0]?.urls?.small || null;
  } catch (err) {
    if (__DEV__) {
      const reason = err?.name === 'AbortError' ? 'timed out' : err?.message || 'unknown error';
      console.warn(`[aiChatEngine] Unsplash request for "${trimmedQuery}" failed: ${reason}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendChatMessage({ message, wardrobe = [], history = [] }) {
  if (!message || !message.trim()) {
    throw new Error('Message is empty.');
  }

  // Read directly from the Zustand store rather than accepting it as a
  // caller-supplied parameter — every screen that talks to the stylist
  // gets the exact same, always-current biometric/style data without
  // having to collect and forward these fields itself.
  const profile = useUserStore.getState();

  const requestBody = {
    contents: buildContents(message, profile, wardrobe, history),
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  };

  let payload;
  try {
    payload = await fetchWithFallback(requestBody);
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      // Every model in the fallback chain is rate-limited right now —
      // degrade gracefully instead of throwing and breaking the chat UI.
      return { text: RATE_LIMIT_APOLOGY, outfitIds: [], newItems: [] };
    }
    throw err;
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Your stylist sent back an empty response.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error('Your stylist sent back malformed data. Please try again.');
  }

  if (!parsed || typeof parsed.text_response !== 'string') {
    throw new Error('Your stylist response is missing text_response.');
  }

  const wardrobeIds = new Set(wardrobe.map((item) => item.id));
  const outfitIds = Array.isArray(parsed.suggested_outfit_ids)
    ? parsed.suggested_outfit_ids.filter((id) => wardrobeIds.has(id))
    : [];

  // `responseMimeType: 'application/json'` only guarantees valid JSON syntax,
  // not that the model sticks to our exact field names — it has been
  // observed returning e.g. {brand, model} instead of {name, search_query}.
  // Normalize known variants instead of silently dropping the whole
  // recommendation when that happens.
  function normalizeNewItem(item) {
    if (!item || typeof item !== 'object') return null;

    const name = item.name || [item.brand, item.model].filter(Boolean).join(' ');
    const searchQuery =
      item.search_query || [item.brand, item.model].filter(Boolean).join(' ').toLowerCase();

    if (!name || !searchQuery) return null;
    return { name, search_query: searchQuery, url: item.url, image_url: item.image_url };
  }

  const rawNewItems = Array.isArray(parsed.new_items_to_buy)
    ? parsed.new_items_to_buy.map(normalizeNewItem).filter(Boolean)
    : [];

  const newItems = await Promise.all(
    rawNewItems.map(async (item) => ({
      name: item.name,
      searchQuery: item.search_query,
      // Prefer Gemini's own image_url when it's at least a well-formed
      // http(s) URL — it's often a real product photo. Gemini frequently
      // gets this wrong (broken/hallucinated links), so the UI still needs
      // its own <Image onError> fallback regardless. Fall back to an
      // Unsplash search when Gemini didn't provide one (or it's malformed).
      imageUrl: isHttpUrl(item.image_url) ? item.image_url : await fetchImageFromUnsplash(item.search_query),
      // Same reasoning for the buy link: trust Gemini's "url" only if it's
      // a well-formed http(s) string, otherwise fall back to the same
      // deterministic Google-search format Rule #4 asks it to produce
      // inline — guarantees the card is never left with a dead/missing link.
      buyUrl: isHttpUrl(item.url) ? item.url : buildBuySearchUrl(item.name),
    }))
  );

  return { text: parsed.text_response, outfitIds, newItems };
}

// "Zero-Closet" counterpart to sendChatMessage — called instead of it
// whenever wardrobe.length === 0, since there's no closet to build outfits
// from yet. Returns shopping-reference "board items" (with a profile-tied
// "reason" each) rather than outfitIds/newItems. `weather` is optional
// (useWeather() may still be 'loading' or 'error') — describeWeather()
// degrades to "not available" rather than the prompt guessing conditions.
export async function fetchInspirationBoard({ message, history = [], weather = {} }) {
  if (!message || !message.trim()) {
    throw new Error('Message is empty.');
  }

  const profile = useUserStore.getState();

  const requestBody = {
    contents: buildInspirationContents(message, profile, weather, history),
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  };

  let payload;
  try {
    payload = await fetchWithFallback(requestBody);
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      return { text: RATE_LIMIT_APOLOGY, boardItems: [] };
    }
    throw err;
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Your stylist sent back an empty response.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error('Your stylist sent back malformed data. Please try again.');
  }

  if (!parsed || typeof parsed.text_response !== 'string') {
    throw new Error('Your stylist response is missing text_response.');
  }

  const rawBoardItems = Array.isArray(parsed.board_items) ? parsed.board_items : [];

  const boardItems = (
    await Promise.all(
      rawBoardItems.map(async (item) => {
        if (!item || typeof item !== 'object' || !item.name) return null;
        return {
          name: item.name,
          reason: item.reason || '',
          imageUrl: isHttpUrl(item.image_url)
            ? item.image_url
            : await fetchImageFromUnsplash(item.search_query),
          buyUrl: isHttpUrl(item.url) ? item.url : buildBuySearchUrl(item.name),
        };
      })
    )
  ).filter(Boolean);

  return { text: parsed.text_response, boardItems };
}
