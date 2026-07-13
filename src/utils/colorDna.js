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
