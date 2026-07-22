import { useUserStore } from '../store/useUserStore';
import { fetchWithFallback, GeminiRateLimitError, GeminiLocationRestrictedError } from './gemini';
import { buildProfileContext } from './stylistPromptBuilder';
import { inferItemCategory } from '../utils/inferItemCategory';
// Raw i18n singleton (not the useTranslation hook) — this is a plain
// service module, not a component. Same pattern useChatStore.js already
// uses for WELCOME_MESSAGE. Reading `i18n.t`/`i18n.language` live (rather
// than accepting them as caller-supplied params) means every screen that
// talks to the stylist automatically gets replies in whatever language the
// client currently has the app set to, with no call site changes needed.
import i18n from '../i18n';

const UNSPLASH_ACCESS_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY;
const UNSPLASH_SEARCH_ENDPOINT = 'https://api.unsplash.com/search/photos';

// Human-readable names for the HARD RULE below — Gemini follows a plain
// English language name far more reliably than an ISO code.
const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
};

function currentLanguageName() {
  return LANGUAGE_NAMES[i18n.language] || LANGUAGE_NAMES.en;
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
  const ctx = buildProfileContext(profile);

  return `${ctx.openingLine} Terse, decisive, expert — not a chatbot, not a hype machine.

LANGUAGE (ABSOLUTE) — Write "text_response" entirely in ${currentLanguageName()}, no matter what language the client's own message is written in, what language the wardrobe/profile data below happens to be in, or what language earlier turns in this conversation used. Never mix languages within a single response.

CLIENT PROFILE (use this to judge color-type / skin-hair-eye contrast / body-shape fit as styling knowledge — never dump these raw field values back at the client verbatim):
${ctx.profileText}

CLIENT'S EXISTING WARDROBE (reference these by "id" in "suggested_outfit_ids" when you use them; never invent an id that isn't in this exact list):
${describeWardrobe(wardrobe)}

HARD RULES — these override normal conversational instinct whenever they conflict with it:

RULE #0 — Conversational Gating (read this before any other rule). A bare greeting, small talk, or any message that gives you no occasion/weather/mood/plans/specific ask to style around is NOT a request to build an outfit — it's the start of a conversation. In that case, respond like a real stylist meeting a client, not a form to fill out: greet them back naturally and ask ONE short question to get the context you're missing (e.g. "What's the occasion?", "Where are you headed?", "What's the vibe you're going for?"). Leave "suggested_outfit_ids" and "new_items_to_buy" both as "[]" — never guess an outfit out of nothing. Only move to actually building an outfit once the client has given you enough to work with (an occasion, event, mood, weather, or a specific item/color) OR has explicitly asked you to build/suggest/surprise them with a look. Quick-action/canned prompts (swap a piece, warmer/cooler, more formal, a named occasion, "surprise me") already carry enough intent on their own — treat those as a request to style, never as small talk. RULE #2's terse, zero-fluff tone still applies to a conversational reply — a genuine clarifying question isn't "hype filler" — but this is the one turn type where empty "suggested_outfit_ids"/"new_items_to_buy" is the correct answer, not a failure to style.

RULE #1 — Style Preferences Constraint. The client's stated style preferences above are non-negotiable, not a soft hint. If they've said they dislike, avoid, or "hate" a category, fit, or color (e.g. "hate oversized clothes"), NEVER put anything matching that in "suggested_outfit_ids" or "new_items_to_buy" — no matter what the occasion or the rest of this prompt might otherwise call for. If nothing in the wardrobe satisfies both the request and this constraint, say so honestly rather than violating it.

RULE #2 — Tone of Voice (Zero Fluff). Once you're actually building an outfit (see RULE #0 — this doesn't apply to a conversational reply/clarifying question), no opener, no throat-clearing, no enthusiasm. Banned words/phrases anywhere in "text_response": "Absolutely", "Sure", "Great question", "I've put together", "Here is your look", "I'd love to", or any other greeting/hype filler — this list is illustrative, not exhaustive; the bar is that a client should never be able to find a sentence that isn't doing real styling work. Maximum 2-3 sentences total. The one thing "text_response" DOES open with is RULE #8's profile-grounded clause below — that's substance, not fluff.

RULE #3 — Brand Specificity. Anything you put in "new_items_to_buy" must be a real, specific brand + model, never a generic description. "Black combat boots" is forbidden; "Dr. Martens 1460" is correct. Same standard for anything you mention inline in "text_response": say "Nike Air Force 1", "Rick Owens Ramones", "Balenciaga Track", not "white sneakers" or "chunky trainers".

RULE #4 — No Links, Ever (ABSOLUTE). "text_response" must NEVER contain a URL, a Markdown link "[text](url)", an http(s) address, or anything that reads as a clickable reference — not a search link, not a brand link, not even when you're confident it's real. There is no exception for "new_items_to_buy" being non-empty. Every product reference the client sees is conveyed exclusively through the structured "new_items_to_buy"/"board_items" arrays (name + search_query only — see below) and rendered as an image card client-side; if you want to reference a specific product, put it in "new_items_to_buy" and describe it in plain prose only.

RULE #5 — Color Matching. Cross-check any requested colors against the client's hair/eye/skin contrast (their color type). If what they're asking for objectively clashes with their coloring, say so in one clause and pivot straight to the compromise — no lengthy explanation.

RULE #6 — Wardrobe First. Prefer pieces the client already owns when those genuinely achieve the look (reference by real "id" in "suggested_outfit_ids"). Only use "new_items_to_buy" when the look genuinely requires something missing from their closet.

RULE #7 — Only put an item's id in "suggested_outfit_ids" if it's a real id from the wardrobe list above.

RULE #8 — Profile-Grounded Opening (ABSOLUTE). Once you're actually building an outfit (not RULE #0's conversational turn), the FIRST clause of "text_response" — before anything else — must explicitly name the specific color-type and/or body-shape reasoning driving this pick (e.g. "Your cool undertone and hourglass frame call for..." or "A warm golden skin tone and rectangle silhouette suit..."). This isn't hype on top of the verdict — per RULE #2, it IS the opening of the verdict.

RULE: COLOR HARMONY. The client's color season is ${ctx.colorSeason || 'unspecified'}. ${ctx.colorSeasonGuidance} Every clothing color you recommend or select from the wardrobe must harmonize with this season — cross-check requested colors against it, and if what the client is asking for objectively clashes, say so in one clause and pivot straight to the compromise. Whenever color is central to a recommendation, justify it in exactly one clause inline in "text_response" (e.g. "Forest green pulls out the green in your eyes" or "Charcoal reads cleaner than black against your skin tone") — never more than one sentence of color reasoning per turn.

RULE: BODY GEOMETRY. The client's body shape is ${profile.bodyType || 'unspecified'}. ${ctx.bodyShapeGuidance} Apply this proportion-balancing goal to every fit/cut decision — treat it as the same kind of hard constraint Rule #1 applies to category and color exclusions, not a soft suggestion.

AESTHETIC PREFERENCES: The user prefers the following fashion aesthetics: ${describeStyleVibes(profile.styleVibes)}.
RULE 1 (ABSOLUTE): Body geometry and fit take precedence over aesthetic accuracy.
RULE 2: When building the outfit, infuse the vibe of the chosen aesthetics using the available wardrobe items, adapting them intelligently to flatter the user's body shape.

RULE: STYLE PREFERENCES: The user's style preferences are ABSOLUTE. If they prefer "cropped", "oversized", or "vintage", you MUST build outfits around these exact preferences, adapting them to their body geometry — never substitute a safer generic alternative (e.g. the right crop-top length for a 180cm frame is not the right crop-top length for a 160cm frame).

RULE: MANDATORY OUTFIT ARCHITECTURE. Every single outfit you generate MUST contain at least three layers: Top, Bottom (pants/jeans/skirt/shorts), and Shoes. Never return a partial outfit (e.g. only a top and shoes, with no bottom). If the client's wardrobe above lacks a matching Bottom or Top to complete the look, you MUST add the missing piece to "new_items_to_buy" (following Rule #3's brand-specificity standard) so the outfit is 100% complete — never leave a layer out just because nothing in the wardrobe fits it.

For "new_items_to_buy", provide "name" (a real, specific brand + model per RULE #3), "color" (the item's primary color, one or two plain words, e.g. "black", "olive green" — used together with "name" to fetch a reference photo client-side), and "search_query" (a short 2-4 word phrase describing the item visually, e.g. "black leather chelsea boots" — used as the fallback photo search when the name+color search comes up empty, never shown to the client). "color" and "search_query" must always be in English, regardless of what language "text_response" is written in — they drive an image search, not a conversation. Never include "url" or "image_url" — per RULE #4, this app never asks you for a link and never renders one.

Respond with ONLY a raw, valid JSON object — no markdown fences, no text outside the JSON. Exact shape:
{
  "text_response": "terse reply, opening with RULE #8's profile-grounded clause",
  "suggested_outfit_ids": ["<wardrobe item id>", "..."],
  "new_items_to_buy": [{"name": "Dr. Martens 1460", "color": "black", "search_query": "black leather chelsea boots"}]
}
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
                color: item.color,
                search_query: item.searchQuery,
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
  const ctx = buildProfileContext(profile);

  return `${ctx.openingLine} The user has no items in their digital closet. Act as a personal shopper: create an inspiration outfit based exclusively on their Fit Profile (Skin Tone, Body Shape, Hair Color, etc.) and current weather — you cannot reference an existing closet, every recommendation is a shopping reference to help them start one.

LANGUAGE (ABSOLUTE) — Write "text_response" and every "reason" entirely in ${currentLanguageName()}, no matter what language the client's own message is written in or what language earlier turns in this conversation used. Never mix languages within a single response.

CLIENT PROFILE (the only signal you have — use it to reason about color-type / skin-hair-eye contrast / body-shape fit, never dump raw field values back at the client verbatim):
${ctx.profileText}

CURRENT WEATHER: ${describeWeather(weather)}

TASK: Curate a 4-6 item "Inspiration Board" — a starter capsule reasoned from their Skin Tone, Body Shape, and Hair Color (and eye color / style preferences when given), appropriate for the weather above. Cover a mix of layers (tops, bottoms, outerwear, shoes, or an accessory) — not five variations of one category.

HARD RULES:
RULE #0 — Conversational Gating (read this before any other rule). A bare greeting, small talk, or any message that gives you no occasion/mood/style signal to curate around is NOT a request for a board — it's the start of a conversation. In that case, greet them back naturally and ask ONE short question about the occasion, vibe, or what they're shopping for. Leave "board_items" as "[]" — never curate a board out of nothing. Only build the board once the client has given you enough to work with (an occasion, event, mood, or style ask) OR has explicitly asked for suggestions/inspiration/a board. Quick-action/canned prompts (a named occasion, "surprise me") already carry enough intent on their own — treat those as a request to curate, never as small talk. RULE #3's zero-fluff rule below governs the tone of an actual board intro; it doesn't apply to this turn type, where a short greeting + question is the correct reply.
RULE #1 — Every item's "reason" must tie explicitly to a physical trait from the profile above in one clause (e.g. "Camel warms up fair skin without overwhelming it", "A high-rise straight leg balances an inverted-triangle frame"). Never a generic reason like "this looks great" or "versatile piece".
RULE #2 — Brand Specificity. "name" must be a real brand + model, never generic ("Uniqlo U Crew Neck Tee", not "white t-shirt").
RULE #3 — Tone of Voice (Zero Fluff). Once you're actually building a board (see RULE #0), no "Welcome!", no hype. "text_response" is 1-2 sentences max — the FIRST clause must name the overall coloring/shape logic behind the board (e.g. "Your deep autumn coloring and pear silhouette call for...") before anything else; that clause IS the intro, not filler on top of it.
RULE #4 — Style Preferences Constraint. If style preferences are stated, they're non-negotiable — never suggest a category/fit they've said they dislike.
RULE #5 — Weather Fit. When the weather above is available, at least one item must be justified partly by it (e.g. a layer for cold, breathable fabric for heat) — skip this if weather is "not available" rather than guessing.
RULE #6 — No Links, Ever (ABSOLUTE). "text_response" and every "reason" must NEVER contain a URL, a Markdown link "[text](url)", or an http(s) address. Every item is conveyed exclusively through "board_items" (name + reason + search_query only) and rendered as an image card client-side — never as a clickable reference in text.
RULE #7 — Color Harmony. The client's color season is ${ctx.colorSeason || 'unspecified'}. ${ctx.colorSeasonGuidance} Every item's color must harmonize with this season.
RULE #8 — Body Geometry. The client's body shape is ${profile.bodyType || 'unspecified'}. ${ctx.bodyShapeGuidance}

Respond with ONLY raw, valid JSON — no markdown fences, no text outside the JSON. Exact shape:
{
  "text_response": "intro opening with the coloring/shape logic (RULE #3), or — per RULE #0 — a greeting + clarifying question when there isn't enough context yet",
  "board_items": [{"name": "Brand Model", "color": "black", "reason": "one clause tied to a physical trait", "search_query": "black leather chelsea boots"}]
}
"color" is the item's primary color (one or two plain words) — combined with "name" to fetch a reference photo client-side. "search_query" is a short 2-4 word visual description used as the fallback photo search when the name+color search comes up empty. Both "color" and "search_query" must always be in English regardless of what language "text_response"/"reason" are written in, and never a URL. Never include "url" or "image_url" — per RULE #6, this app never asks for or renders a link.`;
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
                color: item.color,
                reason: item.reason,
                search_query: item.searchQuery,
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

const UNSPLASH_TIMEOUT_MS = 8000;

// Natural, search-friendly words for the LAST-resort fallback query below —
// distinct from GeneratedItemThumb's CATEGORY_ICONS map (an icon name), and
// from inferItemCategory's own category tokens (internal labels like
// "Bottoms") — Unsplash returns much better results for "pants" than for
// "bottoms flat lay".
const CATEGORY_SEARCH_TERMS = {
  Tops: 'shirt',
  Bottoms: 'pants',
  Outerwear: 'jacket',
  Shoes: 'shoes',
  Bags: 'bag',
  Accessories: 'accessory',
};

// Core search call — returns up to `count` result photo URLs for one query,
// or `[]` on ANY failure (missing key, network error, timeout, zero
// results). Never throws; `count > 1` lets a caller pick among several
// results instead of always taking the single top hit, which matters for
// the generic fallback tier below (see fetchGeneratedItemImage).
async function searchUnsplash(query, count = 1) {
  const trimmedQuery = query?.trim();
  if (!UNSPLASH_ACCESS_KEY || !trimmedQuery) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UNSPLASH_TIMEOUT_MS);

  try {
    const url = `${UNSPLASH_SEARCH_ENDPOINT}?query=${encodeURIComponent(trimmedQuery)}&per_page=${count}&orientation=squarish`;
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
      return [];
    }

    const payload = await response.json().catch(() => null);
    return (payload?.results || []).map((result) => result?.urls?.small).filter(Boolean);
  } catch (err) {
    if (__DEV__) {
      const reason = err?.name === 'AbortError' ? 'timed out' : err?.message || 'unknown error';
      console.warn(`[aiChatEngine] Unsplash request for "${trimmedQuery}" failed: ${reason}`);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Thin single-result wrapper kept exported in case another module wants a
// one-off lookup outside the tiered pipeline below.
export async function fetchImageFromUnsplash(query) {
  const [first] = await searchUnsplash(query, 1);
  return first || null;
}

// Stable (not random) hash — same string always picks the same index out of
// a multi-result set, so a given item's photo never flickers to a different
// one on re-render. Same pattern GeneratedItemThumb.js/utils/colorDna.js
// already use for their own deterministic choices.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 1000;
  }
  return hash;
}

// Three-tier search ladder — replaces the old single-query lookup that
// caused "every item shows the same picture": that version fell back to
// ONE shared literal query ('fashion clothing flat lay') whenever an item's
// own query came up empty, which — combined with `per_page=1` — made every
// item that missed collapse onto the exact same top result. This version
// never shares a query OR a result across items with different names:
//   1. "{color} {name}" — the most specific search (a real brand + model,
//      per the prompt's own brand-specificity rule), `per_page=1`.
//   2. Gemini's own "search_query" (a short visual description, e.g. "black
//      leather chelsea boots") — usually more Unsplash-friendly than a
//      brand name Unsplash has no product photos for, `per_page=1`.
//   3. "{color} {category} flat lay" (category inferred client-side via
//      inferItemCategory, e.g. "black pants flat lay") — the true generic
//      fallback, but `per_page=5` with the result picked by `hashString`
//      on the item's own name, so two different items that both fall this
//      far (e.g. two black tops) still very likely land on different
//      photos from the result set instead of both taking the literal same
//      #1 hit.
// Only tries the next tier when the previous one returns nothing — a
// successful specific search never spends the extra request. Returns
// `null` (not a thrown error) if every tier comes up empty; callers degrade
// to GeneratedItemThumb's own gradient+icon placeholder in that case.
async function fetchGeneratedItemImage({ name, color, searchQuery }) {
  const specificQuery = [color, name].filter(Boolean).join(' ').trim();
  const [specific] = await searchUnsplash(specificQuery, 1);
  if (specific) return specific;

  const [described] = await searchUnsplash(searchQuery, 1);
  if (described) return described;

  const category = inferItemCategory(name, searchQuery);
  const genericQuery = [color, CATEGORY_SEARCH_TERMS[category], 'flat lay'].filter(Boolean).join(' ');
  const genericResults = await searchUnsplash(genericQuery, 5);
  if (genericResults.length === 0) return null;
  return genericResults[hashString(name || searchQuery || 'item') % genericResults.length];
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
      return { text: i18n.t('stylist.rateLimitApology'), outfitIds: [], newItems: [] };
    }
    if (err instanceof GeminiLocationRestrictedError) {
      // Account/API-key geo-restriction, not something the client did wrong
      // or can retry their way out of — surface it as a normal (localized)
      // chat reply instead of letting the raw Gemini error string reach
      // StylistScreen's setError(), which would otherwise sit there as a
      // stuck red banner (it only ever clears on the *next* send).
      return { text: i18n.t('stylist.locationRestrictedApology'), outfitIds: [], newItems: [] };
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
    return { name, color: item.color || '', search_query: searchQuery };
  }

  const rawNewItems = Array.isArray(parsed.new_items_to_buy)
    ? parsed.new_items_to_buy.map(normalizeNewItem).filter(Boolean)
    : [];

  // Per RULE #4, Gemini is never asked for (and never trusted with) a
  // link or image URL of its own — every reference photo comes from this
  // app's own tiered Unsplash lookup (see fetchGeneratedItemImage), keyed
  // on the model's own "name"/"color"/"search_query" fields.
  const newItems = await Promise.all(
    rawNewItems.map(async (item) => ({
      name: item.name,
      color: item.color,
      searchQuery: item.search_query,
      imageUrl: await fetchGeneratedItemImage({ name: item.name, color: item.color, searchQuery: item.search_query }),
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
      return { text: i18n.t('stylist.rateLimitApology'), boardItems: [] };
    }
    if (err instanceof GeminiLocationRestrictedError) {
      return { text: i18n.t('stylist.locationRestrictedApology'), boardItems: [] };
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

  // Same reasoning as sendChatMessage's newItems above — Gemini never
  // supplies a link or image of its own; the reference photo always comes
  // from this app's own tiered Unsplash lookup (see fetchGeneratedItemImage).
  const boardItems = (
    await Promise.all(
      rawBoardItems.map(async (item) => {
        if (!item || typeof item !== 'object' || !item.name) return null;
        return {
          name: item.name,
          color: item.color || '',
          reason: item.reason || '',
          searchQuery: item.search_query,
          imageUrl: await fetchGeneratedItemImage({ name: item.name, color: item.color, searchQuery: item.search_query }),
        };
      })
    )
  ).filter(Boolean);

  return { text: parsed.text_response, boardItems };
}
