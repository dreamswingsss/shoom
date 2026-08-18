// Smart AI Style Advisor — rule engine (see the feature's PRD). Deliberately
// NOT calling Gemini here: isColorMatch/isCutMatch are pure, synchronous,
// deterministic lookups — the same item+profile always produces the same
// verdict. Gemini's only job (elsewhere, see aiScanner.js's getAdvisorMessage)
// is to phrase a caring explanation once a verdict already says something
// needs styling — never to decide the verdict itself.
//
// 🔶 Both CUT_BODY_TYPE tables below are a hand-drafted hypothesis built from
// general styling heuristics (the "balance the silhouette" logic most
// personal-styling guides use), not sourced from a professional stylist
// consultant. Flagged in the PRD as a pre-launch validation risk — treat
// these as a v1 draft, not settled fashion law.

export const VERDICT = {
  PERFECT: 'perfect',
  NEUTRAL: 'neutral',
  AVOID: 'avoid',
};

// Base silhouette vocabulary the Gemini scanner is asked to classify every
// item into (see aiScanner.js). Same naming convention as CATEGORIES/
// COLOR_OPTIONS in constants/wardrobeOptions.js (capitalized, used directly
// as both the stored value and the t() key suffix) rather than a separate
// snake_case enum, so a future "Edit details" cut ChipPicker slots in the
// same way category/color already do.
export const CUT_OPTIONS = ['Oversize', 'Fitted', 'Straight', 'A-Line', 'Draped', 'Peplum', 'Fit and Flare'];

// Item categories the matrices actually distinguish between — top/bottom
// behave very differently for the same body type (see Pear below), so this
// is a required dimension, not an optional refinement. Deliberately NOT the
// same list as wardrobeOptions.js's CATEGORIES (Tops/Bottoms/Outerwear/Shoes/
// Accessories/Bags) — Shoes/Accessories/Bags have no meaningful "cut" concept
// and "Dress" isn't its own top-level category there (it's a subcategory).
// The caller (ScanSheet's advisor integration, not yet built) is responsible
// for mapping a scanned item onto one of these four before calling
// isCutMatch; isCutMatch itself just returns NEUTRAL for anything it doesn't
// recognize rather than guessing.
export const CUT_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear'];

// Shorthand for building one bodyType+category cell — only PERFECT and
// AVOID need listing; anything not named in either list falls through to
// NEUTRAL in isCutMatch below. Keeps the tables readable as "here's what
// actually matters for this shape," matching how real styling guides read
// (a short do/don't list, not an opinion on every possible cut).
function rule(perfect = [], avoid = []) {
  return { perfect, avoid };
}

// ---------------------------------------------------------------------------
// FEMALE — keys match BODY_TYPES_WOMEN in constants/profileOptions.js
// exactly (including the parenthetical labels) since bodyType is stored and
// looked up as that literal string.
// ---------------------------------------------------------------------------
export const FEMALE_CUT_MATRIX = {
  // Balanced shoulders/hips, defined waist — the one shape whose main asset
  // (the waist) a cut can either showcase or hide. Oversize/Straight are
  // the two silhouettes that hide it, which is why they're the universal
  // "avoid" here across every category.
  Hourglass: {
    top: rule(['Fitted', 'Draped'], ['Oversize', 'Straight']),
    bottom: rule(['Fitted', 'Straight'], ['Oversize']),
    dress: rule(['Fitted', 'Draped', 'Fit and Flare'], ['Oversize', 'Straight']),
    outerwear: rule(['Fitted'], ['Oversize']),
  },

  // Hips wider than shoulders, waist defined — goal is drawing attention up
  // and avoiding extra volume on hips/thighs. Top rules are permissive
  // (that's not where the imbalance is); bottom/dress rules actively avoid
  // anything that flares or adds bulk at hip level.
  'Pear (Triangle)': {
    top: rule(['Fitted', 'Draped'], []),
    bottom: rule(['Straight', 'A-Line'], ['Oversize', 'Fit and Flare']),
    dress: rule(['A-Line'], ['Fit and Flare', 'Peplum', 'Oversize']),
    outerwear: rule(['Straight', 'Fitted'], ['Oversize', 'Peplum']),
  },

  // Fuller midsection, slimmer legs — goal is skimming over the midsection
  // rather than clinging to it. Fitted/Peplum (both define/hug the waist)
  // are the worst choices everywhere on top; Oversize is graded PER
  // category below, not blanket-avoided — see the caveat after this table.
  'Apple (Round)': {
    top: rule(['Draped', 'A-Line', 'Straight'], ['Fitted', 'Peplum', 'Oversize']),
    bottom: rule(['Straight', 'A-Line', 'Oversize'], ['Fitted']),
    dress: rule(['Draped', 'A-Line', 'Fit and Flare'], ['Fitted', 'Peplum', 'Oversize']),
    outerwear: rule(['Straight', 'A-Line', 'Draped'], ['Fitted', 'Oversize']),
  },

  // Shoulders/waist/hips similar width, little natural waist definition —
  // goal is creating the illusion of a waist. Peplum/Draped/Fit and Flare
  // all do that; Oversize/Straight both reinforce the "no shape" line this
  // body type is trying to counter.
  Rectangle: {
    top: rule(['Peplum', 'Draped'], ['Oversize', 'Straight']),
    bottom: rule(['A-Line', 'Fit and Flare'], ['Oversize']),
    dress: rule(['Peplum', 'Draped', 'Fit and Flare'], ['Oversize', 'Straight']),
    outerwear: rule(['Peplum', 'Draped'], ['Oversize', 'Straight']),
  },

  // Shoulders/bust broader than hips — mirror image of Pear: goal is
  // adding volume below and avoiding it above. Bottom rules deliberately
  // treat Oversize as PERFECT (wide-leg silhouettes balance the frame) even
  // though Oversize is an "avoid" on top for this same body type — the
  // whole point of splitting by category.
  'Inverted Triangle': {
    top: rule(['Straight', 'Fitted', 'Draped'], ['Oversize']),
    bottom: rule(['A-Line', 'Fit and Flare', 'Oversize'], ['Fitted']),
    dress: rule(['A-Line', 'Fit and Flare'], ['Oversize', 'Fitted']),
    outerwear: rule(['Straight', 'Fitted'], ['Oversize']),
  },
};

// ---------------------------------------------------------------------------
// MALE — keys match BODY_TYPES_MEN exactly. Note 'Rectangle' and 'Inverted
// Triangle' are literal string overlaps with the female table above (both
// option lists share those two labels) — this is exactly why isCutMatch
// below takes `gender` and picks a matrix, rather than one flat table keyed
// by bodyType alone; the same label means a different rule set per gender.
// ---------------------------------------------------------------------------
export const MALE_CUT_MATRIX = {
  // Broad shoulders, narrower waist — the "reference" male proportions most
  // style guides build around. Most cuts work; the only real risk is
  // burying already-good proportions under Oversize.
  Trapezoid: {
    top: rule(['Fitted', 'Straight'], ['Oversize']),
    bottom: rule(['Straight', 'Fitted'], []),
    dress: rule([], []),
    outerwear: rule(['Fitted', 'Straight'], ['Oversize']),
  },

  // Broad shoulders/chest, narrower hips — same imbalance as the female
  // Inverted Triangle: avoid adding bulk up top, add ease below.
  'Inverted Triangle': {
    top: rule(['Straight', 'Fitted'], ['Oversize']),
    bottom: rule(['Straight', 'Oversize'], ['Fitted']),
    dress: rule([], []),
    outerwear: rule(['Straight'], ['Oversize']),
  },

  // Straight up-and-down, little waist definition. Menswear doesn't lean on
  // Peplum/Draped the way the female Rectangle rules do — the equivalent
  // advice is simpler: fitted or straight (structured), never Oversize
  // (drowns the frame instead of defining it).
  Rectangle: {
    top: rule(['Fitted', 'Straight'], ['Oversize']),
    bottom: rule(['Straight', 'Fitted'], ['Oversize']),
    dress: rule([], []),
    outerwear: rule(['Fitted', 'Straight'], ['Oversize']),
  },

  // Fuller midsection — the requested "hides the stomach" shape. Straight/
  // Draped skim over the midsection; Fitted clings to and emphasizes it
  // (worst choice); Oversize is avoided top/outerwear for the same reason
  // as the female Apple case (adds overall bulk instead of concealing).
  Oval: {
    top: rule(['Straight', 'Draped'], ['Fitted', 'Oversize']),
    bottom: rule(['Straight', 'A-Line'], ['Fitted']),
    dress: rule([], []),
    outerwear: rule(['Straight'], ['Fitted', 'Oversize']),
  },

  // Hips/lower body wider than shoulders (the male mirror of Pear) — add
  // structure up top, keep the bottom close to the body rather than
  // widening it further.
  Triangle: {
    top: rule(['Fitted', 'Straight'], []),
    bottom: rule(['Straight'], ['Oversize', 'Fitted']),
    dress: rule([], []),
    outerwear: rule(['Fitted', 'Straight'], ['Oversize']),
  },
};

// GENDERS is now just 'Men'/'Women' (a third 'Other' option existed before,
// dropped at the user's request), but a legacy account that already saved
// 'Other' — or any account with gender still unset — falls back to
// dedupeUnion(BODY_TYPES_MEN, BODY_TYPES_WOMEN) (see getBodyTypeOptions in
// constants/profileOptions.js) for its body type options — a merged list, so
// a given bodyType may only exist in one of the two tables above (e.g.
// 'Hourglass' or 'Oval'), or in both under different rules (e.g.
// 'Rectangle'). For anything other than an explicit 'Men'/'Women' gender,
// this tries the female table first, then the male table — first one that
// actually has rules for this bodyType wins, rather than guessing which was
// "meant."
function resolveCutMatrix(gender, bodyType) {
  if (gender === 'Men') return MALE_CUT_MATRIX;
  if (gender === 'Women') return FEMALE_CUT_MATRIX;
  if (FEMALE_CUT_MATRIX[bodyType]) return FEMALE_CUT_MATRIX;
  if (MALE_CUT_MATRIX[bodyType]) return MALE_CUT_MATRIX;
  return null;
}

// Pure, synchronous — same four inputs always produce the same verdict.
// Returns NEUTRAL (never throws) for any bodyType/category/cut this hasn't
// been taught an opinion about, rather than guessing.
export function isCutMatch(cut, bodyType, category, gender) {
  const matrix = resolveCutMatrix(gender, bodyType);
  const categoryRules = matrix?.[bodyType]?.[category];
  if (!categoryRules || !cut) return VERDICT.NEUTRAL;

  if (categoryRules.avoid.includes(cut)) return VERDICT.AVOID;
  if (categoryRules.perfect.includes(cut)) return VERDICT.PERFECT;
  return VERDICT.NEUTRAL;
}

// Bridges the two color vocabularies in play: scanned items always store one
// of COLOR_OPTIONS' generic words (constants/wardrobeOptions.js — 'Blue',
// 'Yellow', 'Brown', …), while Color DNA palettes (colorDna.js's
// LIGHT_PALETTE/DEEP_PALETTE) use descriptive fashion names ('Navy',
// 'Mustard', 'Terracotta', …). Without this, isColorMatch's plain substring
// check ("blue".includes("navy")? no) matches almost nothing — this is the
// fix for that, not a nice-to-have.
//
// Keyed by COLOR_OPTIONS family, each listing every descriptive palette name
// that actually belongs to it. 🔶 Manually curated against today's palette
// content (colorDna.js) — covers all 11 current best/avoid entries; revisit
// whenever a new descriptive color is added to a palette or a new family to
// COLOR_OPTIONS. A couple of judgment calls worth knowing about:
//   - 'Mustard' appears in BOTH LIGHT_PALETTE's avoid and DEEP_PALETTE's
//     best — not a conflict, since a given person only has one active
//     palette; textbook seasonal color theory actually agrees (warm mustard
//     flatters deep/warm undertones, clashes with fair/cool ones).
//   - 'Terracotta' filed under Orange (not Brown) — reads primarily as a
//     burnt-orange tone in fashion contexts, closer to Neon Orange than
//     Muddy Brown.
//   - 'Cream' filed under Beige (not White) — warmer/yellower than a true
//     white, closer to the Beige family.
//   - 'Multicolor' has no shade list on purpose — a genuinely multicolor
//     item can't be judged as a single color family, so it always falls
//     through to NEUTRAL rather than forcing a verdict.
const GENERIC_COLOR_TO_PALETTE_SHADES = {
  Black: [],
  White: [],
  Gray: [],
  Beige: ['Cream'],
  Brown: ['Muddy Brown'],
  Red: [],
  Orange: ['Neon Orange', 'Terracotta'],
  Yellow: ['Mustard', 'Pale Yellow'],
  Green: ['Emerald', 'Olive'],
  Blue: ['Navy'],
  Purple: ['Lavender'],
  Pink: ['Soft Rose'],
  Multicolor: [],
};

// Color-DNA side of the verdict. Checks the item's generic color against
// each palette entry's family (via the dictionary above) first; falls back
// to the original substring match for any descriptive name the dictionary
// doesn't yet cover, so a future palette addition degrades gracefully
// instead of silently never matching until someone remembers to update
// GENERIC_COLOR_TO_PALETTE_SHADES.
export function isColorMatch(color, palette) {
  const normalized = color?.trim();
  if (!normalized || !palette) return VERDICT.NEUTRAL;

  const lowerNormalized = normalized.toLowerCase();
  const shades = GENERIC_COLOR_TO_PALETTE_SHADES[normalized] || [];

  const matchesAny = (list) =>
    list.some((c) => {
      if (shades.some((shade) => shade.toLowerCase() === c.name.toLowerCase())) return true;
      const rawName = c.name.toLowerCase();
      return lowerNormalized.includes(rawName) || rawName.includes(lowerNormalized);
    });

  if (matchesAny(palette.avoid)) return VERDICT.AVOID;
  if (matchesAny(palette.best)) return VERDICT.PERFECT;
  return VERDICT.NEUTRAL;
}
