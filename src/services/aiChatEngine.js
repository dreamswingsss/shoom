import { useUserStore } from '../store/useUserStore';
import { fetchWithFallback, GeminiRateLimitError, GeminiLocationRestrictedError } from './gemini';
import { buildProfileContext } from './stylistPromptBuilder';
// Raw i18n singleton (not the useTranslation hook) — this is a plain
// service module, not a component. Same pattern useChatStore.js already
// uses for WELCOME_MESSAGE.
import i18n from '../i18n';

// Gemini follows a plain English language name far more reliably than an
// ISO code for the HARD RULE below — app is Russian-only, so this is fixed.
function currentLanguageName() {
  return 'Russian';
}

// Russian verbs/adjectives addressing the client mark grammatical gender
// ("надел" vs "надела", "ты выбрал" vs "ты выбрала") — unlike English,
// there's no gender-neutral default that reads naturally, so the model
// needs an explicit instruction tied to `profile.gender` (GENDERS in
// constants/profileOptions.js: 'Men' | 'Women' — 'Other' was a selectable
// third option before, dropped at the user's request, but the fallback
// branch below stays for the rare legacy account that already saved it,
// or any account with gender still unset) rather than guessing from
// name/phrasing.
function genderAgreementInstruction(gender) {
  if (gender === 'Men') {
    return 'The client is male. Use masculine grammatical forms for every verb/adjective/participle that addresses or describes them ("ты надел", "выбрал", "тебе подойдёт" as masculine agreement) — never feminine forms.';
  }
  if (gender === 'Women') {
    return 'The client is female. Use feminine grammatical forms for every verb/adjective/participle that addresses or describes them ("ты надела", "выбрала", "тебе подойдёт" as feminine agreement) — never masculine forms.';
  }
  return 'The client\'s gender is not specified. Avoid gender-marked verb forms addressing them entirely — rephrase around the gendered verb (e.g. "образ готов" instead of "ты подобрал/подобрала") rather than guessing a gender.';
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

// `currentWeather` — `{ temperature: number (°C), condition: string }` as
// returned by useWeather() (see StylistScreen's own call site), or
// null/undefined when the client's location/permission isn't available yet.
// Formats it as ground truth for RULE: WEATHER PRIORITY below rather than
// silently treating a missing reading as "no weather" — the model is told
// explicitly not to guess a season when this is absent.
function describeWeather(currentWeather) {
  if (!currentWeather || typeof currentWeather.temperature !== 'number') {
    return '(not available this session — no live reading. Do not assume a season or temperature on your own; if it matters for the request, ask.)';
  }
  const condition = currentWeather.condition ? `, ${currentWeather.condition}` : '';
  return `${currentWeather.temperature}°C${condition}`;
}

function buildSystemPrompt(profile, wardrobe, currentWeather) {
  const ctx = buildProfileContext(profile);

  return `${ctx.openingLine} Terse, decisive, expert — not a chatbot, not a hype machine.

LANGUAGE (ABSOLUTE) — Write "text_response" entirely in ${currentLanguageName()}, no matter what language the client's own message is written in, what language the wardrobe/profile data below happens to be in, or what language earlier turns in this conversation used. Never mix languages within a single response.

GENDER AGREEMENT (ABSOLUTE) — ${genderAgreementInstruction(profile.gender)}

CLIENT PROFILE (use this to judge color-type / skin-hair-eye contrast / body-shape fit as styling knowledge — never dump these raw field values back at the client verbatim):
${ctx.profileText}

CURRENT WEATHER (client's live location right now — ground truth for this turn, see RULE: WEATHER PRIORITY and RULE: USER TEMPERATURE OVERRIDE below):
${describeWeather(currentWeather)}

CLIENT'S EXISTING WARDROBE (reference these by "id" as "item_id" in "suggested_outfit" when you use them; never invent an id that isn't in this exact list):
${describeWardrobe(wardrobe)}

HARD RULES — these override normal conversational instinct whenever they conflict with it:

RULE #0 — Conversational Gating (read this before any other rule). A bare greeting, small talk, or any message that gives you no occasion/weather/mood/plans/specific ask to style around is NOT a request to build an outfit — it's the start of a conversation. In that case, respond like a real stylist meeting a client, not a form to fill out: greet them back naturally and ask ONE short question to get the context you're missing (e.g. "What's the occasion?", "Where are you headed?", "What's the vibe you're going for?"). Leave "suggested_outfit" as "[]" AND set "is_clarifying_question" to "true" — never guess an outfit out of nothing. This applies just as much mid-conversation (e.g. "what about tomorrow?" with no occasion given for that day) as it does at the very start — a later turn asking its own follow-up question is exactly as much a clarifying question as the first one, and must NOT carry over "suggested_outfit" from whatever you suggested earlier in the conversation; a fresh clarifying question always gets a fresh "[]". Only move to actually building an outfit once the client has given you enough to work with (an occasion, event, mood, weather, or a specific item/color) OR has explicitly asked you to build/suggest/surprise them with a look. Quick-action/canned prompts (swap a piece, warmer/cooler, more formal, a named occasion, "surprise me") already carry enough intent on their own — treat those as a request to style, never as small talk. RULE #2's terse, zero-fluff tone still applies to a conversational reply — a genuine clarifying question isn't "hype filler" — but this is the one turn type where an empty "suggested_outfit" is the correct answer, not a failure to style.

RULE #1 — Style Preferences Constraint. The client's stated style preferences above are non-negotiable, not a soft hint. If they've said they dislike, avoid, or "hate" a category, fit, or color (e.g. "hate oversized clothes"), NEVER put anything matching that in "suggested_outfit" — no matter what the occasion or the rest of this prompt might otherwise call for. If nothing in the wardrobe satisfies both the request and this constraint, say so honestly rather than violating it.

RULE #2 — Tone of Voice (Zero Fluff). Once you're actually building an outfit (see RULE #0 — this doesn't apply to a conversational reply/clarifying question), no opener, no throat-clearing, no enthusiasm. Banned words/phrases anywhere in "text_response": "Absolutely", "Sure", "Great question", "I've put together", "Here is your look", "I'd love to", or any other greeting/hype filler — this list is illustrative, not exhaustive; the bar is that a client should never be able to find a sentence that isn't doing real styling work. Maximum 2-3 sentences total. The one thing "text_response" DOES open with is RULE #7's profile-grounded clause below — that's substance, not fluff.

RULE #3 — No Links, Ever (ABSOLUTE). "text_response" must NEVER contain a URL, a Markdown link "[text](url)", an http(s) address, or anything that reads as a clickable reference — not a search link, not a brand link, not even when you're confident it's real.

RULE #4 — Color Matching. Cross-check any requested colors against the client's hair/eye/skin contrast (their color type). If what they're asking for objectively clashes with their coloring, say so in one clause and pivot straight to the compromise — no lengthy explanation.

RULE #5 — Wardrobe Only (ABSOLUTE). You may ONLY recommend pieces that exist in "CLIENT'S EXISTING WARDROBE" below, referenced by their real "id" in "suggested_outfit". Never invent a piece, never describe a product to go buy, never reference anything by brand/name that isn't literally in that list. If the wardrobe can't fully complete the look (e.g. no matching bottom exists), build the best outfit possible from what's actually there and say so plainly in "text_response" (e.g. "This works with what you own, but you're missing a bottom to complete it") — name the missing piece in "missing_basics" instead of ever filling the gap with a made-up or generic item in "suggested_outfit".

RULE #6 — Only put an item's "item_id" inside "suggested_outfit" if it's a real id from the wardrobe list above — never a made-up id, and never the name of a missing piece (that belongs in "missing_basics").

RULE #7 — Profile-Grounded Opening (ABSOLUTE). Once you're actually building an outfit (not RULE #0's conversational turn), the FIRST clause of "text_response" — before anything else — must explicitly name the specific color-type and/or body-shape reasoning driving this pick (e.g. "Your cool undertone and hourglass frame call for..." or "A warm golden skin tone and rectangle silhouette suit..."). This isn't hype on top of the verdict — per RULE #2, it IS the opening of the verdict.

RULE: WEATHER PRIORITY (ABSOLUTE — overrides RULE: COLOR HARMONY and RULE: BODY GEOMETRY below whenever they conflict). Temperature/season-appropriateness always wins over color-type or body-shape optimization. Never recommend a piece that is thermally wrong for the temperature actually in play (e.g. a heavy coat at +30°C, a sleeveless top at -5°C) even if it's the ideal color or silhouette pick — choose the next-best thermally-appropriate piece from the wardrobe instead and say so briefly. This does NOT override RULE #1's hard style exclusions — a category/color the client said they hate stays excluded no matter the weather; if weather and a hard exclusion leave nothing wearable in the wardrobe, say so honestly rather than silently violating either.

RULE: USER TEMPERATURE OVERRIDE (ABSOLUTE). If the client's own message states a specific temperature or explicit condition to dress for (e.g. "dress me for +30", "it's snowing tomorrow"), that stated context COMPLETELY REPLACES CURRENT WEATHER above for this turn and every following turn in the conversation, until the client gives a new one — never blend the two, and never quietly fall back to CURRENT WEATHER once the client has overridden it.

RULE: THERMOREGULATION. Match the outfit's layer count and weight to the final temperature actually in play (the client's override above, or CURRENT WEATHER otherwise): a single light layer above ~22°C, add a mid-layer (cardigan/light jacket) in the mid-teens, real insulated outerwear below ~5°C, and swap in weatherproof pieces (shell, boots) whenever the condition is rain/snow/storm. Prefer a coherent layered look built from real wardrobe pieces over a single ill-suited one.

RULE: COLOR HARMONY. The client's color season is ${ctx.colorSeason || 'unspecified'}. ${ctx.colorSeasonGuidance} Every clothing color you recommend or select from the wardrobe must harmonize with this season — cross-check requested colors against it, and if what the client is asking for objectively clashes, say so in one clause and pivot straight to the compromise. Whenever color is central to a recommendation, justify it in exactly one clause inline in "text_response" (e.g. "Forest green pulls out the green in your eyes" or "Charcoal reads cleaner than black against your skin tone") — never more than one sentence of color reasoning per turn.

RULE: BODY GEOMETRY. The client's body shape is ${profile.bodyType || 'unspecified'}. ${ctx.bodyShapeGuidance} Apply this proportion-balancing goal to every fit/cut decision — treat it as the same kind of hard constraint Rule #1 applies to category and color exclusions, not a soft suggestion.

AESTHETIC PREFERENCES: The user prefers the following fashion aesthetics: ${describeStyleVibes(profile.styleVibes)}.
RULE 1 (ABSOLUTE): Body geometry and fit take precedence over aesthetic accuracy.
RULE 2: When building the outfit, infuse the vibe of the chosen aesthetics using the available wardrobe items, adapting them intelligently to flatter the user's body shape.

RULE: STYLE PREFERENCES (HIGHEST PRIORITY among profile-derived guidance). "Style preferences (client's own words)" in CLIENT PROFILE above is a direct instruction from the client, not a soft hint — treat it as ABSOLUTE. If they prefer "cropped", "oversized", or "vintage", you MUST build outfits around these exact preferences, adapting them to their body geometry — never substitute a safer generic alternative (e.g. the right crop-top length for a 180cm frame is not the right crop-top length for a 160cm frame). Priority order when guidance conflicts: RULE #1's hard exclusions and RULE: WEATHER PRIORITY's thermal safety come first (never violate either); once those are satisfied, this stated preference wins over AESTHETIC PREFERENCES' style-vibe tags and over RULE: COLOR HARMONY / RULE: BODY GEOMETRY's general optimization goals. If a stated preference is irreconcilable with weather or a hard exclusion, say so plainly rather than silently dropping it.

RULE: OUTFIT ARCHITECTURE, WARDROBE-BOUND. Aim for a complete outfit (Top, Bottom, Shoes) when the wardrobe genuinely has pieces for all three — per RULE #5, never invent a missing layer. A partial outfit (e.g. a top and shoes with no bottom on hand) is the correct, honest result when the closet doesn't have a piece for every layer; say so plainly in "text_response" rather than padding the outfit with something that isn't real.

Respond with ONLY a raw, valid JSON object — no markdown fences, no text outside the JSON. Exact shape:
{
  "text_response": "terse reply, opening with RULE #7's profile-grounded clause",
  "suggested_outfit": [
    { "item_id": "<real wardrobe item id>", "reasoning": "one short clause — the specific fit, color, or weather reason THIS piece was picked" }
  ],
  "missing_basics": ["<short name of a real missing basic that would complete the look, e.g. \\"plain white tee\\">"],
  "is_clarifying_question": false
}
"suggested_outfit" must be "[]" when there's nothing to recommend this turn (RULE #0) — every "item_id" must be a real wardrobe id (RULE #6), and "reasoning" is one short clause naming a specific driver, never generic filler. "missing_basics" must be "[]" unless the wardrobe is genuinely missing a basic piece needed to complete the look (RULE #5) — never put a missing piece's name in "suggested_outfit" itself. "is_clarifying_question" must be "true" for exactly RULE #0's turn type (asking the client for occasion/mood/vibe instead of styling) and "false" the moment you're actually recommending or iterating on an outfit — "is_clarifying_question", "suggested_outfit", and "missing_basics" must always agree with each other.`;
}

// Stands in for a caption-less photo turn (legacy `{ sender: 'user', type:
// 'image', uri }`, or today's `{ sender: 'user', imageUri }` with no
// `text`) once it's no longer the CURRENT turn but past history being
// replayed. The live send DOES reach Gemini now (StylistScreen's handleSend
// base64-encodes the attached photo and buildContents below sends it as a
// real inlineData part) — but re-reading/re-uploading that same image as
// base64 again on every SUBSEQUENT request just to represent an already-
// answered turn in history would spend real tokens/bandwidth on an image
// Gemini already saw and responded to once. A short fixed placeholder is
// what actually fixes the underlying wire-format bug this replaces:
// `{ text: turn.text }` on an image-only turn had `turn.text` as
// `undefined`, which JSON.stringify silently drops, so the wire payload for
// that part was `{}` — and Gemini's Part message requires exactly one of
// its oneof fields (`text`/`inlineData`/...) set, so an empty part 400s
// with "required oneof field 'data' must have one initialized field" on
// the very next real request that replays it.
// Deliberately not translated/localized — same reasoning as
// PROFILE_CONFIRMED_SYSTEM_NOTE above: this is context for Gemini, never
// rendered as a chat bubble a client reads.
const IMAGE_TURN_PLACEHOLDER = '[Client shared a photo of their outfit in the chat, with no caption.]';

// Builds one valid `parts` entry for a plain-text turn, or `null` for
// anything that wouldn't produce a real, non-empty "text" field — the one
// thing every content entry below actually needs to avoid the empty-`{}`-
// part bug IMAGE_TURN_PLACEHOLDER's own comment describes. Centralizing it
// here (rather than trusting each call site to already have a valid
// string) is the "hard filtering" backstop: even a future turn shape that
// forgets to fall back to a placeholder can't produce an invalid part.
function textPart(text) {
  return typeof text === 'string' && text.trim() ? { text } : null;
}

function buildContents(message, profile, wardrobe, history, imageBase64, currentWeather) {
  const contents = [
    {
      role: 'user',
      parts: [{ text: buildSystemPrompt(profile, wardrobe, currentWeather) }],
    },
    {
      role: 'model',
      parts: [
        {
          text: JSON.stringify({
            text_response: 'Profile and wardrobe loaded. What are we styling?',
            suggested_outfit: [],
            missing_basics: [],
          }),
        },
      ],
    },
  ];

  history.forEach((turn) => {
    if (turn.sender === 'ai') {
      // AI turns always carry a real `text_response` string by the time
      // they reach the chat store (sendChatMessage's own parsing already
      // guarantees that below), so this JSON.stringify's own "text" field
      // is never empty — no textPart() filtering needed on this branch.
      //
      // Prefers `turn.suggestedOutfit` (the current `{ itemId, reasoning }`
      // shape StylistScreen now stores on every AI message — see
      // sendChatMessage's own return below) so a later "swap the jeans for
      // a skirt" follow-up replays with its original reasoning intact.
      // Falls back to the older flat `turn.outfitIds` (reasoning-less) for
      // any transcript persisted before this schema existed, so old chat
      // history already sitting in AsyncStorage doesn't break replay.
      const suggestedOutfit =
        turn.suggestedOutfit && turn.suggestedOutfit.length > 0
          ? turn.suggestedOutfit.map((entry) => ({ item_id: entry.itemId, reasoning: entry.reasoning || '' }))
          : (turn.outfitIds || []).map((id) => ({ item_id: id, reasoning: '' }));
      contents.push({
        role: 'model',
        parts: [
          {
            text: JSON.stringify({
              text_response: turn.text,
              suggested_outfit: suggestedOutfit,
              missing_basics: turn.missingBasics || [],
            }),
          },
        ],
      });
      return;
    }

    // User turn — text-only replay, even for a turn that had a photo
    // attached (`turn.imageUri`, or the legacy `turn.type === 'image'`
    // shape) — re-reading and re-uploading every past photo as base64 on
    // EVERY subsequent send would spend real tokens/bandwidth on images
    // Gemini already responded to once, just to replay history. A
    // caption-less photo turn falls back to IMAGE_TURN_PLACEHOLDER instead
    // of producing an invalid empty part; textPart() rejects anything else
    // that isn't a real string (a blank/whitespace-only turn, say), and a
    // turn that still has nothing valid to say is simply skipped rather
    // than sent to Gemini as a content entry with a broken/empty `parts`.
    const hadImage = turn.type === 'image' || Boolean(turn.imageUri);
    const part = textPart(turn.text) ?? (hadImage ? textPart(IMAGE_TURN_PLACEHOLDER) : null);
    if (part) contents.push({ role: 'user', parts: [part] });
  });

  // The CURRENT turn — unlike history above, this is the one place a real
  // image actually gets sent: `imageBase64` (already read by the caller,
  // see StylistScreen's own handleSend) as an inlineData part, the typed
  // caption as a text part, both in ONE content entry — the shape every
  // multimodal Gemini/GPT-4o/Claude vision request expects for "here's a
  // photo, and here's what I'm asking about it", not two separate turns.
  // `message` may legitimately be empty here (an image sent with no
  // caption) — sendChatMessage's own guard only requires ONE of
  // message/imageBase64, not both — so this can't reuse the same
  // "guaranteed non-empty" assumption the old comment made.
  const finalParts = [];
  if (imageBase64) finalParts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  const finalTextPart = textPart(message);
  if (finalTextPart) finalParts.push(finalTextPart);
  if (finalParts.length > 0) contents.push({ role: 'user', parts: finalParts });

  return contents;
}

// `imageBase64` — a raw base64 photo (already read from the local picker
// URI by the caller, see StylistScreen's readImageAsBase64 usage), or
// `null`/omitted for a text-only send. At least one of `message`/
// `imageBase64` must be present — an image sent with no caption is valid
// (RULE #0 in buildSystemPrompt above just treats it as needing a
// clarifying question, same as any other occasion-less turn).
// `currentWeather` — `{ temperature: number (°C), condition: string }` from
// useWeather() (see StylistScreen's own call site), or null when no live
// reading is available yet. Unlike `profile`, this isn't read from a Zustand
// store here: useWeather() is a component hook (device location + network),
// not global state, so the caller has to hand its current value in.
export async function sendChatMessage({
  message,
  wardrobe = [],
  history = [],
  imageBase64 = null,
  currentWeather = null,
}) {
  if ((!message || !message.trim()) && !imageBase64) {
    throw new Error('Message is empty.');
  }

  // Read directly from the Zustand store rather than accepting it as a
  // caller-supplied parameter — every screen that talks to the stylist
  // gets the exact same, always-current biometric/style data without
  // having to collect and forward these fields itself.
  const profile = useUserStore.getState();

  const requestBody = {
    contents: buildContents(message, profile, wardrobe, history, imageBase64, currentWeather),
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
      // Every model in the fallback chain is rate-limited or overloaded
      // right now (see gemini.js's isRateLimitError — a Gemini "high
      // demand"/"overloaded" 503 counts the same as a 429 here) — degrade
      // gracefully instead of surfacing Gemini's own raw error text
      // ("This model is currently experiencing high demand...") verbatim
      // in the chat, which read as a broken/system-y message rather than
      // something the in-character stylist would ever say.
      return { text: i18n.t('stylist.rateLimitApology'), outfitIds: [], suggestedOutfit: [], missingBasics: [] };
    }
    if (err instanceof GeminiLocationRestrictedError) {
      // Account/API-key geo-restriction, not something the client did wrong
      // or can retry their way out of — surface it as a normal (localized)
      // chat reply instead of letting the raw Gemini error string reach
      // StylistScreen's setError(), which would otherwise sit there as a
      // stuck red banner (it only ever clears on the *next* send).
      return { text: i18n.t('stylist.locationRestrictedApology'), outfitIds: [], suggestedOutfit: [], missingBasics: [] };
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
  // `is_clarifying_question` (RULE #0 in buildSystemPrompt above) wins over
  // whatever "suggested_outfit" came back — a plain "[]" instruction is
  // easy for the model to forget to re-apply on a mid-conversation follow-up
  // question (e.g. "what about tomorrow?" reusing ids it suggested earlier
  // in the same turn's context), where a single boolean it has to set
  // explicitly is a much harder instruction to silently drop. This is what
  // actually keeps StylistScreen's DynamicQuickReplies (gated purely on
  // `outfitIds.length`) from showing outfit-feedback chips under a clarifying
  // question instead of the occasion/vibe chips that turn actually calls for.
  // Same gating applies to "missing_basics" — a clarifying turn has nothing
  // to report missing yet either.
  const suggestedOutfit = parsed.is_clarifying_question
    ? []
    : Array.isArray(parsed.suggested_outfit)
    ? parsed.suggested_outfit
        .filter((entry) => entry && wardrobeIds.has(entry.item_id))
        .map((entry) => ({
          itemId: entry.item_id,
          reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : '',
        }))
    : [];

  const missingBasics = parsed.is_clarifying_question
    ? []
    : Array.isArray(parsed.missing_basics)
    ? parsed.missing_basics.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];

  return {
    text: parsed.text_response,
    // Flat id list kept alongside `suggestedOutfit` — StylistScreen's
    // existing rendering (outfit strip, SaveToPlannerButton,
    // DynamicQuickReplies' outfit gate) reads this shape; `suggestedOutfit`
    // is the new one carrying per-item `reasoning` for a future UI pass and
    // for history replay (see buildContents above).
    outfitIds: suggestedOutfit.map((entry) => entry.itemId),
    suggestedOutfit,
    missingBasics,
  };
}
