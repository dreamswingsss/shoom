// System Prompt Builder — collects the client's static physical/stylistic
// profile (Color Season, Body Shape, physical measurements, Style Vibes)
// and turns it into hard, deterministic grounding facts + styling rules for
// the Gemini system prompt, instead of leaving the model to infer any of it
// itself from raw field values.
//
// This is deliberately a SEPARATE module from aiChatEngine.js (which owns
// the actual Gemini request/response plumbing, wardrobe formatting, and the
// conversational HARD RULES) — `aiChatEngine.js` imports `buildProfileContext`
// below and splices its output into both of its own system prompts
// (buildSystemPrompt for chat, buildInspirationSystemPrompt for the
// zero-closet path), so there is exactly one place that decides "what does
// this client's body/coloring mean for styling," reused by every prompt
// that needs it.
//
// Not to be confused with `aiStylist.js` (an older, separate, currently
// unused wardrobe-combo generator that asks Gemini to *guess* the color
// season itself as free text) — this module computes it deterministically
// client-side instead, the same "fast, deterministic heuristic" spirit
// `utils/colorDna.js` already uses for the Hub's Color DNA widget, just
// extended into an actual 4-season classification with real styling rules
// attached.

import {
  HAIR_COLORS_MEN,
  HAIR_COLORS_WOMEN,
  EYE_COLORS,
  SKIN_TONES,
  dedupeUnion,
} from '../constants/profileOptions';

const ALL_HAIR_COLORS = dedupeUnion(HAIR_COLORS_MEN, HAIR_COLORS_WOMEN, (option) => option.label);

function hexFor(list, label) {
  return list.find((option) => option.label === label)?.hexColor || null;
}

// Minimal hex -> HSL conversion — no new dependency, just enough to bucket
// a color by hue (warm/cool) and lightness (light/deep).
function hexToHsl(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  let h;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h * 60, s: l > 0.5 ? d / (2 - max - min) : d / (max + min), l };
}

// Warm hues (peachy/golden/olive skin) cluster in this band; anything
// outside it (pinker, rosier, or more neutral-to-cool tones) is bucketed
// cool. This is a simplified heuristic, not a certified colorimetric
// analysis — same caveat `colorDna.js` documents for its own light/deep
// split — but it's deterministic and consistent, which is what the prompt
// needs: the same profile always yields the same season.
const WARM_HUE_MIN = 15;
const WARM_HUE_MAX = 60;
const LIGHT_LIGHTNESS_THRESHOLD = 0.55;

// Classic 2x2 seasonal color analysis: undertone (warm/cool) x depth
// (light/deep), driven primarily by skin tone — hair/eye color are real
// signal in a full analysis but skin undertone is the dominant, most
// reliable factor, and using it alone keeps this deterministic rather than
// trying to arbitrate three disagreeing signals.
export function getColorSeason(skinTone) {
  const skinHex = hexFor(SKIN_TONES, skinTone);
  if (!skinHex) return null;

  const { h, l } = hexToHsl(skinHex);
  const isWarm = h >= WARM_HUE_MIN && h <= WARM_HUE_MAX;
  const isLight = l >= LIGHT_LIGHTNESS_THRESHOLD;

  if (isWarm && isLight) return 'Spring';
  if (isWarm && !isLight) return 'Autumn';
  if (!isWarm && isLight) return 'Summer';
  return 'Winter';
}

const COLOR_SEASON_GUIDANCE = {
  Spring:
    'Warm, clear, bright coloring. Best colors: coral, peach, warm green, golden yellow, ivory. Avoid: muted, dusty, or icy tones — they wash this coloring out.',
  Summer:
    'Cool, soft coloring. Best colors: dusty blue, lavender, rose, soft grey, powder pink. Avoid: high-contrast, overly warm, or neon tones — they overpower this coloring.',
  Autumn:
    'Warm, rich, earthy coloring. Best colors: rust, olive, mustard, chocolate brown, burnt orange. Avoid: icy pastels or bright cool tones — they clash with this coloring.',
  Winter:
    'Cool, deep, high-contrast coloring. Best colors: true red, emerald, black, icy blue, pure white. Avoid: muted, dusty, or warm-earthy tones — they mute this coloring.',
};

export function getColorSeasonGuidance(season) {
  return COLOR_SEASON_GUIDANCE[season] || 'Color season not determined — no strong undertone signal from the profile on file.';
}

// Concrete proportion-balancing rule per body shape — every value that can
// actually come out of `getBodyTypeOptions()` (constants/profileOptions.js),
// covering both the men's and women's option lists plus their shared/synonym
// entries. Each rule names a real technique, not a vague "flatter your
// shape" — this is what RULE: BODY GEOMETRY in aiChatEngine.js's system
// prompt points the model at.
const BODY_SHAPE_GUIDANCE = {
  Hourglass:
    'Shoulders and hips are balanced with a defined waist. GOAL: preserve that waist definition — fitted or wrap silhouettes, belts at the natural waist. AVOID boxy or oversized shapes that hide the waist entirely.',
  Rectangle:
    'Shoulders, waist, and hips are similarly proportioned with minimal waist definition. GOAL: create the illusion of a waist — belts, wrap styles, peplum, cropped jackets, fit-and-flare silhouettes. AVOID perfectly straight, unstructured shapes that read as shapeless.',
  Triangle:
    'Hips wider than shoulders. GOAL: visually broaden/emphasize the shoulders — structured blazers, boat necks, statement sleeves, horizontal stripes on top — and choose darker/simpler bottoms with A-line or straight cuts that skim rather than cling to the hips.',
  'Pear (Triangle)':
    'Hips wider than shoulders. GOAL: visually broaden/emphasize the shoulders — structured blazers, boat necks, statement sleeves, horizontal stripes on top — and choose darker/simpler bottoms with A-line or straight cuts that skim rather than cling to the hips.',
  'Inverted Triangle':
    'Shoulders broader than hips. GOAL: minimize shoulder emphasis (avoid shoulder pads, structured/padded jackets, boat necks) and add visual weight below the waist — wide-leg or flared trousers, patterned or lighter-colored bottoms, A-line skirts.',
  Trapezoid:
    'Shoulder-to-hip ratio is already balanced with minimal waist taper. GOAL: maintain that proportion with structured tailoring; avoid boxy fits that hide the natural taper.',
  Oval:
    'Fuller through the midsection. GOAL: elongate the torso and draw the eye vertically — monochrome or vertical-line outfits, open (unbuttoned) layers, V-necks, structured shoulders. AVOID clingy fabrics or horizontal stripes across the midsection.',
  'Apple (Round)':
    'Fuller through the midsection with a less defined waist. GOAL: elongate vertically and draw attention toward shoulders and legs — empire waistlines or A-line cuts that skim the stomach. AVOID tight waistbands or clingy fits at the midsection.',
};

export function getBodyShapeGuidance(bodyShape) {
  return (
    BODY_SHAPE_GUIDANCE[bodyShape] ||
    'Body shape not specified — default to balanced, well-proportioned fits rather than assuming a specific silhouette correction is needed.'
  );
}

// Formats height/weight/measurements into one line — shared by
// buildProfileContext below so both the chat and inspiration-board system
// prompts describe physical proportions identically.
function describePhysicalParams({ height, weight, measurements = {} }) {
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
    `Height: ${height != null ? `${height}cm` : 'not specified'}`,
    `Weight: ${weight != null ? `${weight}kg` : 'not specified'}`,
    `Body measurements: ${measurementsLine}`,
  ].join('\n');
}

function describeStyleVibes(styleVibes) {
  return styleVibes && styleVibes.length > 0 ? styleVibes.join(', ') : 'none specified';
}

// The one function callers actually need: takes the raw profile object
// (shape matches useUserStore's own fields — gender, hairColor, eyeColor,
// skinTone, bodyType, height, weight, measurements, styleVibes,
// stylePreferences) and returns everything a system prompt needs to ground
// itself in this specific client's body and coloring, both as ready-to-
// paste text blocks and as the raw computed values (for callers that want
// to build their own wording around them).
export function buildProfileContext(profile = {}) {
  const { gender, hairColor, eyeColor, skinTone, bodyType, stylePreferences, styleVibes } = profile;

  const colorSeason = getColorSeason(skinTone);
  const bodyShapeGuidance = getBodyShapeGuidance(bodyType);
  const colorSeasonGuidance = getColorSeasonGuidance(colorSeason);

  // The literal templated sentence: "You are an expert fashion stylist.
  // Your client has a [Body Shape] body type and a [Color Type] color
  // season." — always the first thing the model reads about this client,
  // before any raw field dump, so the two facts that drive every other
  // rule are never buried.
  const openingLine = `You are an expert fashion stylist. Your client has a ${bodyType || 'unspecified'} body type and a ${colorSeason || 'unspecified'} color season.`;

  const rawProfileLines = [
    `Gender: ${gender || 'not specified'}`,
    `Hair color: ${hairColor || 'not specified'}`,
    `Eye color: ${eyeColor || 'not specified'}`,
    `Skin tone: ${skinTone || 'not specified'}`,
    `Color season (derived from skin tone): ${colorSeason || 'not enough data to determine'}`,
    `Body shape: ${bodyType || 'not specified'}`,
    describePhysicalParams(profile),
    `Preferred style vibes: ${describeStyleVibes(styleVibes)}`,
    `Style preferences (client's own words): ${stylePreferences?.trim() ? `"${stylePreferences.trim()}"` : 'not specified'}`,
  ];

  return {
    colorSeason,
    bodyShapeGuidance,
    colorSeasonGuidance,
    openingLine,
    profileText: rawProfileLines.join('\n'),
  };
}
