import { StyleSheet } from 'react-native';

// Redesign v10 ("Noctis / Marigold") — supersedes v9's "Mother Earth" brown/
// gold pass below. v9's own comment already documented this file's history
// of chasing a moving-target mockup (v6/v7/v8/v9 each read a DIFFERENT
// snapshot of the same evolving `Wardrobe App Redesign v2.dc.html` and
// landed on values matching none of them by the time each pass shipped).
// This pass is grounded in a DIFFERENT, newer, explicitly-named file instead
// — `Shoom App - Noctis Marigold.html` (Downloads, exported ~13 min after
// the v2.dc.html snapshots v9 was chasing) — verified the same way v9 was
// supposed to be: live, via `getComputedStyle` on the rendered prototype
// (served over local HTTP + a real Chrome tab, not by reading its minified
// source), not eyeballed off a screenshot or guessed from the file's own
// color-name callouts (which include a `#E3A419` "Marigold" brand swatch
// that turns out NOT to be what's actually used for the functional accent
// — see `marigold` below).
//
// Colors only — fonts deliberately left on Manrope/CormorantGaramond. The
// mockup itself uses Archivo/Instrument Serif/Anton, but none of those are
// bundled in this app yet (no font files, no `expo-font` registration) —
// pulling in three new typefaces is a separate decision with its own asset
// footprint, not something to fold silently into a token-value pass.
//
// Borders/shadows follow the same convention v9 established: every neutral
// overlay derives from one ink hex + alpha (`withAlpha` below), so a card
// border, a divider, and a modal backdrop are all "ink at some opacity",
// and a button glow is "the accent at some opacity", never a bespoke color.

function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Base ink triad + canvas — every value below is a `getComputedStyle()`
// reading off the live prototype (see this file's own top-of-file comment),
// not a value transcribed from the file's color-name callout cards.
// `ink` ("Noctis") is the one dark color the whole UI is built from: primary
// text, primary CTA fill (`Изменить профиль`/`Добавить вещь`/nav bar
// background), same "one dark color IS the accent" shape v9's own comment
// described for the brown it replaces.
const ink = '#1F2235';
// Avatar gradient's second stop (`linear-gradient(145deg, ink, inkDark)`) —
// near-black navy, not a lighter tint despite sitting next to `ink`.
const inkDark = '#12141F';
const inkSecondary = '#474C63';
const inkMuted = '#8A8FA3';
// Redesign v11 ("Hidden Gem") — `paper` moved off the original v10 prototype's
// saturated peach-tan to a desaturated warm bone. The old `#F3E4D8` sat
// inside the exact "premium-consumer beige" family the design-taste-frontend
// skill bans by name (neighbors of its own banned `#efeae0`/`#e8dfcb`
// examples) — every premium-consumer app defaults here, which is the whole
// problem. `#F2ECE1` keeps the same warm-not-cold family (still reads as
// "bone", not Acloset's cold white) while landing outside that banned range.
const paper = '#F2ECE1';
const white = '#FFFFFF';

// Redesign v11 — replaces v10's `marigold` (`#C98A12`, a saturated brass/
// ochre — the other half of that same banned beige+brass pairing) with
// Behr's 2026 Color of the Year "Hidden Gem", a desaturated blue-green.
// Kept the `marigold` constant/export name for call-site stability (every
// screen already reads `colors.marigold`) even though the hue itself is now
// jade, not gold — same pattern this file already used once before for
// `violetLight` after ITS role changed color.
const marigold = '#596D69';

// `violet`/`coral`/`sky`/`sage` — legacy role names from the original
// 4-accent system (violet/coral/sky/sage, each a distinct hue). The
// Noctis/Marigold prototype doesn't have 4 accent hues anymore: every icon
// rendered navy regardless of which tile/tint it sat on (verified across
// the Closet hero card, stat tiles, Planner/Copilot tiles, and every
// Profile row icon), and the only OTHER functional color anywhere is
// `marigold` above, used exclusively for the active nav pill. So every
// legacy accent role collapses to `ink` except the one that's visibly
// distinct — kept as separate constants (not one shared variable) purely so
// call sites reading `colors.sky` etc. keep working unchanged.
const violet = ink;
const coral = marigold;
const sky = ink;
const sage = ink;

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

  // Text stays the same red across every revision so far — `#D14343`
  // verified unchanged in the new prototype's own "Выйти" (Log out) button.
  // Its background tint DID change: verified `#FBEBC4`, the same warm
  // marigold-tinted cream as the Closet hero card (not the pale blue an
  // earlier pass found in a since-superseded source).
  danger: '#D14343',
  dangerBackground: '#FBEBC4',
  success: sage,

  // Section accents. `violet` doubles as `accent` — the one color used for
  // primary buttons/navigation/CTAs everywhere, per the spec.
  violet,
  coral,
  sky,
  sage,
  accent: violet,
  // The verified `#C98A12` active-nav-pill color, exposed under its own
  // name (not just via `coral`) so TabNavigator can use it directly as ONE
  // shared active-tab fill — see that file's own comment for why this
  // replaced the old one-hue-per-tab scheme.
  marigold,
  // Second stop of the avatar's gradient fill (`linear-gradient(145deg,
  // ink, inkDark)`, verified via getComputedStyle) — name kept for call-site
  // stability even though it's now a darker, not lighter, tone.
  violetLight: inkDark,

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

// Tint backgrounds for plaques/tiles/icon chips. Verified via
// getComputedStyle on the actual rendered cards (Closet hero/stat tiles,
// Profile row icon chips, the "Log out" button) — role mapping (which
// screen section uses which tint) kept from v9's own tracing since the
// SCREENS/LAYOUT are unchanged, only the hex values are new: violet tint =
// Closet hero card + "Log out" button fill; coral tint = Closet streak
// tile; sky tint = Closet capsule-score tile + Profile "Body profile" chip;
// sage tint = Profile "Wear history"/"Language" chips. Every border is
// plain ink-at-alpha regardless of tint hue, same as before.
//
// Unlike the old 4-hue system, this prototype really only cycles through
// two tint FAMILIES — a warm neutral bone (violet/coral/sage below) and one
// cool grey-lavender (sky) — reused across roles rather than one distinct
// hue per role. `sage` is set apart from `violet`/`coral` by a shade, not a
// different hue, to keep 4 distinguishable tokens without inventing a hue
// that isn't actually in the source.
//
// v11: these three were golden-cream literals independent of `marigold`
// (`#FBEBC4`/`#F3E7CD`/`#EFE0BE`) — recomputed as light neutral tints of the
// new bone family so they don't clash now that the accent moved from gold
// to jade. The blob fills below stay derived FROM `marigold` itself, so they
// shift to jade automatically with no separate edit needed here.
export const cardTints = {
  violet: '#EFEAE1',
  violetBorder: withAlpha(ink, 0.2),
  // Decorative hero-card "blob" fill — tinted with the marigold accent
  // (not ink) since a warm highlight reads right on a warm tan card; this
  // specific decorative detail wasn't directly confirmed on the new
  // prototype (no visible blob in the rendered hero card at the checked
  // viewport), so it's a reasoned carryover from the layout spec rather
  // than a getComputedStyle reading like the rest of this file.
  violetBlob: withAlpha(marigold, 0.24),
  coral: '#EAE6DB',
  coralBorder: withAlpha(ink, 0.18),
  coralBlob: withAlpha(marigold, 0.3),
  // Text color for copy set on a WHITE badge sitting on top of the coral
  // tint (e.g. the Planner hero card's "This week" badge) — plain ink, same
  // role v9 documented, unaffected by this palette swap.
  coralInk: ink,
  sky: '#E6E8F0',
  skyBorder: withAlpha(ink, 0.3),
  sage: '#E3E6E1',
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
  // True circles (half of each avatar's own width/height — 38px in
  // WardrobeScreen's header, 64px in ProfileScreen's) — was a squircle-ish
  // 13/22 before, which read as "sharp-cornered" rather than rounded on a
  // real device.
  avatarSm: 19,
  avatarLg: 32,
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

// Redesign v11 — Manrope-for-everything had no real contrast between
// headline and body type. Unbounded (geometric, distinctive) + Golos Text
// (built for Cyrillic UI text by a Russian foundry — this app is
// Russian-only, see AGENTS.md) gave that contrast without reaching for a
// serif, which design-taste-frontend flags as the single most-tested "AI
// default" for anything reading as premium/editorial.
//
// v11.1 — Unbounded swapped for Onest. Unbounded's letterforms run
// unusually wide/heavy even at its own lighter weights, and Russian words
// run longer than their English equivalents to begin with — several
// headline/label spots were overflowing or clipping invisible in the real
// app. Onest is the calmer, narrower pick the redesign article itself
// recommends ("Onest на всё, контраст через 700 и 400"); still distinct
// from Golos Text via weight, still nothing like Inter/Roboto. Both
// registered in App.js's `useFonts` call; verified against ui-ux-pro-max's
// own font database for full Cyrillic + Cyrillic-extended coverage before
// picking them, not assumed.
export const fonts = {
  display: 'Onest',
  body: 'Golos Text',
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
  // Nav-row label / form field label. Spec: 13-13.5px/700/Ink. Golos Text,
  // not Unbounded — `fonts.display` is for genuinely display-sized headings
  // (17px+); Unbounded's geometric weight reads heavy/clunky at this size.
  rowTitle: {
    fontFamily: fonts.body,
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
  // Overline (screen category tag) — the one label role that's always
  // accent-colored. Was 700/uppercase/letterSpacing 1.5 — the small-caps
  // wide-tracking combo design-taste-frontend names as one of the two most
  // recognizable AI-design tells by itself; this app used it ~6x on the
  // Wardrobe hub alone, well past that skill's "max 1 eyebrow per 3
  // sections" rule. Softened at the token level (quieter weight, no
  // uppercase, tight tracking) so it reads as a quiet label instead of a
  // shouted one everywhere it's already used, no call-site changes needed.
  overline: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
    color: colors.violet,
  },
  // Neutral section eyebrow (used above rows/cards throughout the app) —
  // same geometry as `overline`, ink-secondary instead of accent-colored.
  label: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
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
  // Tag / badge. Spec: 10-11.5px/700/accent color by context. Golos Text —
  // same small-size reasoning as `rowTitle` above.
  tag: {
    fontFamily: fonts.body,
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
  // Telegram sign-in button. Spec: 0 6px 16 rgba(ink,0.08).
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
