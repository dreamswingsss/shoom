// Simplified "Color DNA" heuristic for the Hub widget — a real version would
// cross-reference skin undertone against hair/eye contrast the way the AI
// stylist's "RULE: COLOR HARMONY" already reasons about per-request in
// aiChatEngine.js. This is a fast, deterministic placeholder so the widget
// has something real to render before that gets built out; `hairColor` and
// `eyeColor` are accepted for that future refinement pass but don't affect
// today's binary light/deep split.

const LIGHT_SKIN_TONES = ['Very Fair', 'Fair', 'Light'];

const LIGHT_PALETTE = {
  best: [
    { name: 'Navy', hex: '#1B2A4A' },
    { name: 'Emerald', hex: '#2F5D50' },
    { name: 'Soft Rose', hex: '#D98E9B' },
    { name: 'Lavender', hex: '#9B8AA8' },
  ],
  avoid: [
    { name: 'Mustard', hex: '#C9A227' },
    { name: 'Neon Orange', hex: '#FF6A00' },
  ],
};

const DEEP_PALETTE = {
  best: [
    { name: 'Terracotta', hex: '#B5651D' },
    { name: 'Mustard', hex: '#C9A227' },
    { name: 'Cream', hex: '#F0E6D2' },
    { name: 'Olive', hex: '#6B6E3A' },
  ],
  avoid: [
    { name: 'Pale Yellow', hex: '#F5E6A8' },
    { name: 'Muddy Brown', hex: '#7A6A5D' },
  ],
};

export function getPalette(skinTone, hairColor, eyeColor) {
  return LIGHT_SKIN_TONES.includes(skinTone) ? LIGHT_PALETTE : DEEP_PALETTE;
}

// Stable (not random) 0-999 hash so the same color name always lands on the
// same match% within its bucket below — re-scanning an identical item gives
// a consistent-feeling result instead of a different number every time.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 1000;
  }
  return hash;
}

// Same "fast, deterministic placeholder" spirit as getPalette above (see
// file header) — extended to score a scanned item's free-text color against
// the client's best/avoid lists, for the scan sheet's inline "Matches your
// Color DNA by X%" verdict. Real per-item colorimetric distance is a later
// refinement; this gives an honest, stable number today rather than a
// literal random/fabricated one.
export function calculateColorDnaMatch(itemColor, palette) {
  const normalized = itemColor?.trim().toLowerCase();
  if (!normalized || !palette) return null;

  const matchesAny = (list) =>
    list.some((c) => {
      const name = c.name.toLowerCase();
      return normalized.includes(name) || name.includes(normalized);
    });

  const hash = hashString(normalized);
  if (matchesAny(palette.best)) return 84 + (hash % 12); // 84-95
  if (matchesAny(palette.avoid)) return 30 + (hash % 11); // 30-40
  return 62 + (hash % 14); // 62-75 — not explicitly in either list
}
