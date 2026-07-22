import { StyleSheet } from 'react-native';

// Redesign v9 — values verified directly from the live source file
// (`Wardrobe App Redesign v2.dc.html`'s own `renderVals()`, not the prose
// docs). The prose handoff docs (`design_handoff_app_redesign/README.md`,
// `Wardrobe App - Design Tokens.md`) describe an earlier violet/coral/sky/
// sage palette (`#6C4DF6` etc.) with Manrope — but the mockup file itself
// was edited in place past that point (its own on-page banner now reads
// "Design update v3") to a muted brown/gold/blue-grey "Mother Earth"
// palette. Every prior pass in this file's history (v6/v7/v8) was chasing
// one or the other stale source and landed on values matching neither —
// this pass reads the file's actual `var violet = ...` block (and the
// tile/nav-icon style objects that consume it) directly, once, and is the
// first to match what the mockup currently renders. Font stays Manrope by
// deliberate choice (not a source mismatch this time) — the mockup itself
// moved to Archivo/Anton, but porting new font assets was declared out of
// scope for this pass.
//
// Borders/shadows follow the spec's own convention of deriving every
// neutral overlay from a single hex + alpha suffix rather than a separate
// flat color (`withAlpha` below implements that literally) — so a card
// border, a divider, and a modal backdrop are all "ink at some opacity",
// and a button glow is "the accent at some opacity", never a bespoke color.

function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Base ink triad + canvas, read straight off `renderVals()`: `ink`
// literally equals `violet` in the source (same hex, both roles collapse
// to one brown) — kept as separate named constants for call-site clarity,
// but they resolve identically, matching the mockup.
const ink = '#513229';
const inkSecondary = '#6E5A4C';
const inkMuted = '#A99A88';
const paper = '#F4F1E2';
const white = '#FFFFFF';

const violet = '#513229'; // "Mother Earth" — primary accent, == ink
const coral = '#8A7238'; // deep Bay gold — secondary accent
const sky = '#4A6B86'; // deep Something Blue — secondary accent
const sage = '#6E6B45'; // deep Walking Vinnie — auxiliary accent

export const colors = {
  background: paper,
  surface: white,
  textPrimary: ink,
  textSecondary: inkSecondary,
  textMuted: inkMuted,
  inverseBackground: ink,
  inverseText: white,

  // Ink-derived borders. `glassTileStyle`'s own literal border/shadow rgba
  // in the source is still keyed to an older ink hex (`rgba(42,74,64,...)`,
  // a stale leftover from a previous palette pass) rather than today's
  // `rgba(81,50,41,...)` — using today's corrected ink here instead of
  // replicating that leftover; the difference is invisible at 5-7% alpha
  // and keeps every neutral overlay in this file deriving from one source
  // of truth. `borderStrong`'s alpha is an estimate (source has no literal
  // for it); left as-is.
  divider: withAlpha(ink, 0.06),
  border: withAlpha(ink, 0.07),
  borderStrong: withAlpha(ink, 0.14),

  // Text stays the same red across every revision so far. The tint behind
  // it is NOT a red/pink tint in the source — `dangerBtnStyle.background`
  // is literally `#D8EBF9`, the same pale blue as the violet card tint
  // below. Kept as-is per fidelity even though it reads unusually for a
  // destructive action.
  danger: '#D14343',
  dangerBackground: '#D8EBF9',
  success: sage,

  // Section accents. `violet` doubles as `accent` — the one color used for
  // primary buttons/navigation/CTAs everywhere, per the spec.
  violet,
  coral,
  sky,
  sage,
  accent: violet,
  // Second stop of the avatar's gradient fill (`avatarSmallStyle`/
  // `avatarLargeStyle`: `linear-gradient(145deg, violet, #2E1C15)`) — a
  // darker near-black brown, not a lighter tone despite the name; name kept
  // for call-site stability.
  violetLight: '#2E1C15',

  // Inactive tab icon — spec's `#ffffff8a` (54% white) expressed via the
  // same alpha helper instead of a bare hex8 literal.
  navInactiveIcon: withAlpha(white, 0.54),
  // Modal / sheet backdrops app-wide (was independently hardcoded as
  // `rgba(0,0,0,0.4)` in several screens).
  overlay: withAlpha(ink, 0.4),

  // "Surface / glass tile" per spec is a flat `#FFFFFF`, not a translucent
  // layer — kept as its own key since most cards reference `glassCard` by
  // name, but it's now identical to `surface`.
  glassCard: white,
  premiumBackground: paper,
};

// Tint backgrounds for plaques/tiles/icon chips, one per section accent.
// Read directly off the mockup's own `coralTileStyle`/`skyTileStyle`/
// `sageTileStyle`/`violetTileStyle` objects — these are a genuinely
// SEPARATE pastel set from the `violet`/`coral`/`sky`/`sage` accent hexes
// above, not derived from them (e.g. `violetTileStyle` is a pale blue,
// `#D8EBF9`, nothing like the brown `violet` accent). The mapping below is
// by RENDERED ROLE, verified by tracing which literal style object each
// screen section actually uses, not by matching hex-to-name: violet tint =
// Closet hero card + Profile "Notifications"/"Language" chips; coral tint =
// Closet streak tile + Planner hero/plan card + Profile "Style vibes" chip;
// sky tint = Closet capsule tile + Planner plan card + Stylist empty-state
// card + Profile "Fit profile" chip; sage tint = Profile "Wear history"
// chip. Every border in the source is plain INK-at-alpha regardless of
// tint (not the tint's own hue) — replicated as-is since that's genuinely
// what's rendered.
export const cardTints = {
  violet: '#D8EBF9',
  violetBorder: withAlpha(ink, 0.2),
  // Soft decorative "blob" fill for hero cards (an opaque-over-opaque tint
  // would be invisible on its own tile, so this stays a translucent overlay
  // rather than reusing `violet`/`violetBorder`). The source's own
  // `heroBlobStyle` radial-gradient literally hardcodes `rgba(46,74,92,
  // 0.24)` — a stale leftover from an earlier palette pass, not today's
  // ink or violet. Using TODAY's `violet` at that same 0.24 alpha instead
  // of replicating the leftover.
  violetBlob: withAlpha(violet, 0.24),
  coral: '#FCE6B7',
  coralBorder: withAlpha(ink, 0.18),
  // `heroBlobStylePlanner` literally hardcodes `rgba(255,122,89,0.3)` — an
  // OLD coral hex (`#FF7A59`) from a much earlier palette pass, left stale
  // in the source while the `coral` variable itself moved on twice since.
  // Using today's coral at that same 0.3 alpha instead of replicating the
  // stale leftover.
  coralBlob: withAlpha(coral, 0.3),
  // Text color for copy set on a WHITE badge sitting on top of the coral
  // tint (e.g. the Planner hero card's "This week" badge) — the source's
  // own `heroBadgeStylePlanner` uses plain ink here, NOT the coral accent
  // (unlike Closet's hero badge, whose `heroBadgeStyle` uses `color: violet`
  // — see WardrobeScreen's own heroBadgeText, unchanged).
  coralInk: ink,
  sky: '#E7E4CA',
  skyBorder: withAlpha(ink, 0.3),
  sage: '#D7D4B1',
  sageBorder: withAlpha(ink, 0.22),
};

export { withAlpha };

// 8px grid for generic spacing, plus the spec's own named layout constants
// (screen padding, card padding, nav bar geometry, etc.) that don't fall on
// that grid.
export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  xxl: 48,
  xxxl: 56,

  // Spec §4 — named layout primitives.
  // Strict 16px grid: `screenH` is the ONE horizontal screen margin every
  // screen must use (via ScreenContainer, not its own paddingHorizontal),
  // and `gutter` is the ONE inter-element gap (list rows, card grids,
  // stacked buttons) — same 16 value as `sm` above, named for what it's
  // for so call sites read as "the gutter" rather than an arbitrary `sm`.
  // `screenBottom` stays only for screens not yet migrated to
  // ScreenContainer (see that component's own comment) — once a screen
  // renders through it, bottom spacing comes from the real safe-area inset
  // instead of this fixed guess.
  screenH: 16,
  gutter: 16,
  screenBottom: 24,
  cardPadSm: 14,
  cardPadLg: 22,
  gridGap: 12,
  navBarV: 8,
  navBarH: 24,
  navGap: 18,
  contentTop: 52,
};

// Spec §3 — geometry. Cards stay rounder than generic UI chrome; buttons
// are always full pills.
export const radius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
  card: 20,
  cardLg: 24,
  iconWrap: 10,
  avatarSm: 13,
  avatarLg: 22,
};

export const opacity = {
  disabled: 0.4,
};

// The thinnest line the platform can render — used instead of boxed
// borders to separate content ("Clean Line" rule).
export const hairline = {
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: colors.divider,
};

export const fonts = {
  display: 'Manrope',
  body: 'Manrope',
  serif: 'CormorantGaramond',
};

// Spec §2 — type scale. Sizes/weights/colors follow the spec's table;
// names are kept stable from the previous system so existing call sites
// don't need to be renamed, only their values changed.
export const typography = {
  // Screen-level headline (H1) — onboarding, screen titles. Spec: 22-26px/800/Ink.
  h1: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.4,
    color: colors.textPrimary,
  },
  // Section headline (H2). Spec: 17-22px/800/Ink.
  h2: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  // Card / tile title. Spec: 15-19px/800/Ink.
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: colors.textPrimary,
  },
  serif: {
    fontFamily: fonts.serif,
    fontWeight: '600',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 0.3,
    color: colors.textPrimary,
  },
  // Nav-row label / form field label. Spec: 13-13.5px/700/Ink.
  rowTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 13.5,
    lineHeight: 17,
    color: colors.textPrimary,
  },
  // Body text / chat messages. Spec: 14px/600/1.4-1.6 line-height/Ink.
  body: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  bodySecondary: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  // Overline (screen category tag). Spec: 11px/700/letter-spacing 0.14em/
  // uppercase/Violet — the one label role that's always accent-colored.
  overline: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.violet,
  },
  // Neutral section eyebrow (used above rows/cards throughout the app) —
  // same geometry as `overline`, ink-secondary instead of accent-colored.
  label: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  // Secondary caption. Spec: 11-12.5px/600/Ink secondary.
  captionSecondary: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  // Small metadata caption (dates, tags). Spec: 10-11px/600-700/Ink muted.
  caption: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  // Tag / badge. Spec: 10-11.5px/700/accent color by context.
  tag: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 10.5,
    lineHeight: 13,
  },
};

// Spec §5 — shadows. Neutral shadows use Ink at low opacity; colored
// glows use the relevant accent hex at higher opacity, exactly the "hex +
// alpha suffix" convention the spec itself describes.
export const shadows = {
  sm: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  // Card lift. Spec: 0 4px 14 rgba(ink,0.05).
  soft: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 4,
  },
  // Primary CTA glow (e.g. Wardrobe Hub's "Add Item"). Spec: 0 10px 22 rgba(violet,0.3).
  accent: {
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 6,
  },
  // Large avatar. Spec: 0 10px 24 rgba(violet,0.27).
  avatarLg: {
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.27,
    shadowRadius: 24,
    elevation: 6,
  },
  // Floating nav bar. Spec: 0 16px 32 rgba(ink,0.28).
  navBar: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    elevation: 10,
  },
  // Google sign-in button. Spec: 0 6px 16 rgba(ink,0.08).
  googleBtn: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  // Chat send button. Spec: 0 6px 16 rgba(violet,0.33).
  sendBtn: {
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.33,
    shadowRadius: 16,
    elevation: 4,
  },
};

export const animation = {
  buttonActiveOpacity: 0.7,
  cardActiveScale: 0.98,
  transitionDuration: 200,
};

// Primary = inverted (ink fill, paper-colored content). Secondary/Ghost =
// outlined, transparent fill. Danger = outlined in the reserved accent.
// All pill-shaped per the "Clean Line" button rule (cards stay square-ish;
// buttons are the one deliberately rounded shape). Screens that need a
// solid-fill violet/pink treatment instead (e.g. ProfileScreen's redesign
// buttons) define their own local style rather than overriding these —
// several other screens still rely on the outlined look here.
export const buttons = {
  primary: {
    width: '100%',
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    color: colors.inverseText,
    fontSize: 14.5,
    letterSpacing: 0.3,
  },
  secondary: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    color: colors.textPrimary,
    fontSize: 14.5,
    letterSpacing: 0.3,
  },
  danger: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    color: colors.danger,
    fontSize: 14.5,
  },
  disabled: { opacity: opacity.disabled },
};
