import { useUserStore } from '../store/useUserStore';
import { fetchWithFallback, GeminiRateLimitError, GeminiLocationRestrictedError } from './gemini';
import { buildProfileContext } from './stylistPromptBuilder';
// Raw i18n singleton (not the useTranslation hook) — this is a plain
// service module, not a component. Same pattern useChatStore.js already
// uses for WELCOME_MESSAGE. Reading `i18n.t`/`i18n.language` live (rather
// than accepting them as caller-supplied params) means every screen that
// talks to the stylist automatically gets replies in whatever language the
// client currently has the app set to, with no call site changes needed.
import i18n from '../i18n';

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

function buildSystemPrompt(profile, wardrobe) {
  const ctx = buildProfileContext(profile);

  return `${ctx.openingLine} Terse, decisive, expert — not a chatbot, not a hype machine.

LANGUAGE (ABSOLUTE) — Write "text_response" entirely in ${currentLanguageName()}, no matter what language the client's own message is written in, what language the wardrobe/profile data below happens to be in, or what language earlier turns in this conversation used. Never mix languages within a single response.

CLIENT PROFILE (use this to judge color-type / skin-hair-eye contrast / body-shape fit as styling knowledge — never dump these raw field values back at the client verbatim):
${ctx.profileText}

CLIENT'S EXISTING WARDROBE (reference these by "id" in "suggested_outfit_ids" when you use them; never invent an id that isn't in this exact list):
${describeWardrobe(wardrobe)}

HARD RULES — these override normal conversational instinct whenever they conflict with it:

RULE #0 — Conversational Gating (read this before any other rule). A bare greeting, small talk, or any message that gives you no occasion/weather/mood/plans/specific ask to style around is NOT a request to build an outfit — it's the start of a conversation. In that case, respond like a real stylist meeting a client, not a form to fill out: greet them back naturally and ask ONE short question to get the context you're missing (e.g. "What's the occasion?", "Where are you headed?", "What's the vibe you're going for?"). Leave "suggested_outfit_ids" as "[]" — never guess an outfit out of nothing. Only move to actually building an outfit once the client has given you enough to work with (an occasion, event, mood, weather, or a specific item/color) OR has explicitly asked you to build/suggest/surprise them with a look. Quick-action/canned prompts (swap a piece, warmer/cooler, more formal, a named occasion, "surprise me") already carry enough intent on their own — treat those as a request to style, never as small talk. RULE #2's terse, zero-fluff tone still applies to a conversational reply — a genuine clarifying question isn't "hype filler" — but this is the one turn type where an empty "suggested_outfit_ids" is the correct answer, not a failure to style.

RULE #1 — Style Preferences Constraint. The client's stated style preferences above are non-negotiable, not a soft hint. If they've said they dislike, avoid, or "hate" a category, fit, or color (e.g. "hate oversized clothes"), NEVER put anything matching that in "suggested_outfit_ids" — no matter what the occasion or the rest of this prompt might otherwise call for. If nothing in the wardrobe satisfies both the request and this constraint, say so honestly rather than violating it.

RULE #2 — Tone of Voice (Zero Fluff). Once you're actually building an outfit (see RULE #0 — this doesn't apply to a conversational reply/clarifying question), no opener, no throat-clearing, no enthusiasm. Banned words/phrases anywhere in "text_response": "Absolutely", "Sure", "Great question", "I've put together", "Here is your look", "I'd love to", or any other greeting/hype filler — this list is illustrative, not exhaustive; the bar is that a client should never be able to find a sentence that isn't doing real styling work. Maximum 2-3 sentences total. The one thing "text_response" DOES open with is RULE #7's profile-grounded clause below — that's substance, not fluff.

RULE #3 — No Links, Ever (ABSOLUTE). "text_response" must NEVER contain a URL, a Markdown link "[text](url)", an http(s) address, or anything that reads as a clickable reference — not a search link, not a brand link, not even when you're confident it's real.

RULE #4 — Color Matching. Cross-check any requested colors against the client's hair/eye/skin contrast (their color type). If what they're asking for objectively clashes with their coloring, say so in one clause and pivot straight to the compromise — no lengthy explanation.

RULE #5 — Wardrobe Only (ABSOLUTE). You may ONLY recommend pieces that exist in "CLIENT'S EXISTING WARDROBE" below, referenced by their real "id" in "suggested_outfit_ids". Never invent a piece, never describe a product to go buy, never reference anything by brand/name that isn't literally in that list. If the wardrobe can't fully complete the look (e.g. no matching bottom exists), build the best outfit possible from what's actually there and say so plainly in "text_response" (e.g. "This works with what you own, but you're missing a bottom to complete it") — never fill the gap with a made-up or generic item.

RULE #6 — Only put an item's id in "suggested_outfit_ids" if it's a real id from the wardrobe list above.

RULE #7 — Profile-Grounded Opening (ABSOLUTE). Once you're actually building an outfit (not RULE #0's conversational turn), the FIRST clause of "text_response" — before anything else — must explicitly name the specific color-type and/or body-shape reasoning driving this pick (e.g. "Your cool undertone and hourglass frame call for..." or "A warm golden skin tone and rectangle silhouette suit..."). This isn't hype on top of the verdict — per RULE #2, it IS the opening of the verdict.

RULE: COLOR HARMONY. The client's color season is ${ctx.colorSeason || 'unspecified'}. ${ctx.colorSeasonGuidance} Every clothing color you recommend or select from the wardrobe must harmonize with this season — cross-check requested colors against it, and if what the client is asking for objectively clashes, say so in one clause and pivot straight to the compromise. Whenever color is central to a recommendation, justify it in exactly one clause inline in "text_response" (e.g. "Forest green pulls out the green in your eyes" or "Charcoal reads cleaner than black against your skin tone") — never more than one sentence of color reasoning per turn.

RULE: BODY GEOMETRY. The client's body shape is ${profile.bodyType || 'unspecified'}. ${ctx.bodyShapeGuidance} Apply this proportion-balancing goal to every fit/cut decision — treat it as the same kind of hard constraint Rule #1 applies to category and color exclusions, not a soft suggestion.

AESTHETIC PREFERENCES: The user prefers the following fashion aesthetics: ${describeStyleVibes(profile.styleVibes)}.
RULE 1 (ABSOLUTE): Body geometry and fit take precedence over aesthetic accuracy.
RULE 2: When building the outfit, infuse the vibe of the chosen aesthetics using the available wardrobe items, adapting them intelligently to flatter the user's body shape.

RULE: STYLE PREFERENCES: The user's style preferences are ABSOLUTE. If they prefer "cropped", "oversized", or "vintage", you MUST build outfits around these exact preferences, adapting them to their body geometry — never substitute a safer generic alternative (e.g. the right crop-top length for a 180cm frame is not the right crop-top length for a 160cm frame).

RULE: OUTFIT ARCHITECTURE, WARDROBE-BOUND. Aim for a complete outfit (Top, Bottom, Shoes) when the wardrobe genuinely has pieces for all three — per RULE #5, never invent a missing layer. A partial outfit (e.g. a top and shoes with no bottom on hand) is the correct, honest result when the closet doesn't have a piece for every layer; say so plainly in "text_response" rather than padding the outfit with something that isn't real.

Respond with ONLY a raw, valid JSON object — no markdown fences, no text outside the JSON. Exact shape:
{
  "text_response": "terse reply, opening with RULE #7's profile-grounded clause",
  "suggested_outfit_ids": ["<wardrobe item id>", "..."]
}
"suggested_outfit_ids" must be "[]" when there's nothing to recommend this turn.`;
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
      return { text: i18n.t('stylist.rateLimitApology'), outfitIds: [] };
    }
    if (err instanceof GeminiLocationRestrictedError) {
      // Account/API-key geo-restriction, not something the client did wrong
      // or can retry their way out of — surface it as a normal (localized)
      // chat reply instead of letting the raw Gemini error string reach
      // StylistScreen's setError(), which would otherwise sit there as a
      // stuck red banner (it only ever clears on the *next* send).
      return { text: i18n.t('stylist.locationRestrictedApology'), outfitIds: [] };
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

  return { text: parsed.text_response, outfitIds };
}
