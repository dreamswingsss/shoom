// Shared between OnboardingScreen (step-by-step) and EditProfileScreen
// (single scrollable form) — both need the exact same option lists and
// gender-dependent logic.

export const GENDERS = ['Women', 'Men'];

export const HAIR_COLORS_MEN = [
  { label: 'Black', hexColor: '#2A2724' },
  { label: 'Dark Brown', hexColor: '#3F2E22' },
  { label: 'Chestnut', hexColor: '#5C3B26' },
  { label: 'Light Brown', hexColor: '#6B4A32' },
  { label: 'Ash Brown', hexColor: '#6B5D50' },
  { label: 'Ash Blonde', hexColor: '#A89880' },
  { label: 'Sandy Blonde', hexColor: '#C4A575' },
  { label: 'Ginger', hexColor: '#8C4A2E' },
  { label: 'Salt & Pepper', hexColor: '#7A7570' },
  { label: 'Grey', hexColor: '#9B9691' },
  { label: 'White', hexColor: '#DAD3C5' },
  { label: 'Bald / Shaved', hexColor: '#C9AE8C' },
];

export const HAIR_COLORS_WOMEN = [
  { label: 'Jet Black', hexColor: '#211E1C' },
  { label: 'Dark Brown', hexColor: '#3F2E22' },
  { label: 'Chestnut', hexColor: '#5C3B26' },
  { label: 'Auburn', hexColor: '#6B3822' },
  { label: 'Copper', hexColor: '#93502A' },
  { label: 'Golden Blonde', hexColor: '#C2A25C' },
  { label: 'Ash Blonde', hexColor: '#A89880' },
  { label: 'Platinum Blonde', hexColor: '#D6CFC0' },
  { label: 'Balayage', hexColor: '#9C7C58' },
  { label: 'Silver Grey', hexColor: '#A9A9A4' },
];

export const EYE_COLORS = [
  { label: 'Brown', hexColor: '#5C4433' },
  { label: 'Blue', hexColor: '#7C93A8' },
  { label: 'Green', hexColor: '#6B7756' },
  { label: 'Greenish Blue', hexColor: '#6E8C8A' },
  { label: 'Yellowish Green', hexColor: '#8A8F5C' },
  { label: 'Amber', hexColor: '#9C6B3F' },
  { label: 'Hazel', hexColor: '#7A6248' },
  { label: 'Deep Blue', hexColor: '#3E5470' },
  { label: 'Dark Green', hexColor: '#3E4A34' },
  { label: 'Freckled Hazel', hexColor: '#8A7156' },
  { label: 'Greyish Blue', hexColor: '#7D8B94' },
  { label: 'Forest Green', hexColor: '#4B5A40' },
  { label: 'Dark Hazel', hexColor: '#5A4A38' },
  { label: 'Grey', hexColor: '#8C8C88' },
  { label: 'Spring Green', hexColor: '#8C9A72' },
];

export const SKIN_TONES = [
  { label: 'Very Fair', hexColor: '#F5DEC6' },
  { label: 'Fair', hexColor: '#EFC9A0' },
  { label: 'Light', hexColor: '#E0AC80' },
  { label: 'Medium', hexColor: '#C68863' },
  { label: 'Tan', hexColor: '#A9744A' },
  { label: 'Deep', hexColor: '#7A4B2A' },
  { label: 'Very Deep', hexColor: '#4A2C17' },
];

// 6 shapes each, kept as separate lists (not a shared base + gender-specific
// extras) — Trapezoid/Oval only make sense for the men's list, Hourglass/
// Pear/Apple only for the women's, so there's no real shared subset worth
// factoring out beyond Rectangle/Inverted Triangle/Diamond, which already
// happen to use the exact same label (and translation key) in both lists.
export const BODY_TYPES_MEN = ['Trapezoid', 'Inverted Triangle', 'Rectangle', 'Diamond', 'Oval', 'Triangle'];
export const BODY_TYPES_WOMEN = [
  'Hourglass',
  'Pear (Triangle)',
  'Apple (Round)',
  'Rectangle',
  'Inverted Triangle',
  'Diamond',
];

// Technical values sent to the AI stylist prompt verbatim — always English,
// regardless of app language. EditProfileScreen displays these through
// `t('profile.styleVibes.<value>')` for the label, but stores/toggles the
// raw string here so the prompt never has to translate back.
export const STYLE_VIBES = [
  'Old Money',
  'Streetwear',
  'Y2K',
  'Gorpcore',
  'Minimalism',
  'Vintage',
  'Classic',
  'Dark Fashion',
  'Athleisure',
];

export const MAX_STYLE_VIBES = 3;

export function dedupeUnion(a, b, keyFn = (item) => item) {
  const seen = new Map();
  for (const item of [...a, ...b]) {
    const key = keyFn(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

export function getHairColorOptions(gender) {
  if (gender === 'Men') return HAIR_COLORS_MEN;
  if (gender === 'Women') return HAIR_COLORS_WOMEN;
  return dedupeUnion(HAIR_COLORS_MEN, HAIR_COLORS_WOMEN, (option) => option.label);
}

export function getBodyTypeOptions(gender) {
  if (gender === 'Men') return BODY_TYPES_MEN;
  if (gender === 'Women') return BODY_TYPES_WOMEN;
  return dedupeUnion(BODY_TYPES_MEN, BODY_TYPES_WOMEN);
}

export function filterDigits(text) {
  return text.replace(/[^0-9]/g, '');
}

// Imperial <-> metric conversions for the onboarding/profile measurements
// step. The backend (`height_cm`/`weight_kg` columns, see useUserStore)
// only ever stores metric — these let the UI collect ft/in + lbs while
// still writing a single canonical cm/kg pair.
const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

export function feetInchesToCm(feet, inches) {
  const totalInches = (Number(feet) || 0) * 12 + (Number(inches) || 0);
  return Math.round(totalInches * CM_PER_INCH);
}

export function lbsToKg(lbs) {
  return Math.round((Number(lbs) || 0) * KG_PER_LB);
}
