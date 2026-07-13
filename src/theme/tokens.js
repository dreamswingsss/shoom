import { StyleSheet } from 'react-native';

// Redesign v2 — warmer, more colorful system. Cream canvas, near-black
// "ink" text, one confident pastel accent color per section (violet/coral/
// sky/sage) instead of a single blue accent everywhere. Hairline dividers
// instead of boxed containers, tighter card radius, pill buttons.
// Font: Manrope (single family, multiple weights) for both display and
// body — registered in App.js via expo-font, loaded as a single variable-
// font file. Weight is selected via `fontWeight`, not separate PostScript
// names — Google only ships a variable font for this family.
// `danger`/`success` are the only non-monochrome accents outside the
// section-tint system, reserved for destructive/error and confirmation
// states respectively.

export const colors = {
  background: '#FAF6F1',
  surface: '#F5F1EA',
  border: '#E8E2D8',
  borderStrong: '#D4CCBC',
  textPrimary: '#1B1B1F',
  textSecondary: '#6B6B72',
  textMuted: '#A3A3AA',
  inverseBackground: '#1B1B1F',
  inverseText: '#FFFFFF',
  danger: '#D14343',
  success: '#3E8F63',

  // "Modern Premium SaaS" accent layer — added for the Hub (Bento) and
  // Stylist/Chat redesign, then adopted app-wide by redesign v2 (accent is
  // now violet, not Electric Blue). Coexists with the neutral tokens above.
  premiumBackground: '#F8F6F2',
  accent: '#6C4DF6',
  glassCard: 'rgba(255, 255, 255, 0.7)',

  // Redesign v2 — one confident color per section instead of one accent
  // everywhere. `violet` is an alias of `accent` (same value) so call sites
  // that think in "this section's color" terms don't have to know it's
  // also the app's one shared accent.
  violet: '#6C4DF6',
  coral: '#FF7A59',
  sky: '#2F8FE0',
  sage: '#3E8F63',
};

// Solid pastel card fills — NOT translucent, unlike `colors.glassCard`, so
// they stay legible/high-contrast as a full card background rather than a
// glass layer over other content.
export const cardTints = {
  violet: '#EDE7FF',
  coral: '#FFE7DC',
  sky: '#E3ECFC',
  sage: '#E2F1E8',
};

// 8px grid.
export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  xxl: 48,
  xxxl: 56,
};

// Cards stay near-square (0-4px); buttons get `pill` — see `buttons` below.
export const radius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 100,
  // Modern Premium SaaS / redesign v2 card radius — deliberately much
  // rounder than the near-square `lg`/`xl` cards used elsewhere.
  card: 20,
  // Hero cards (challenge card, planner hero, etc.) — a touch rounder still.
  cardLg: 24,
};

export const opacity = {
  disabled: 0.4,
};

// The thinnest line the platform can render — used instead of boxed
// borders to separate content ("Clean Line" rule).
export const hairline = {
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: colors.border,
};

export const fonts = {
  display: 'Manrope',
  body: 'Manrope',
  serif: 'CormorantGaramond',
};

export const typography = {
  h1: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -1,
    color: colors.textPrimary,
  },
  h2: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 22,
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
  body: {
    fontFamily: fonts.body,
    fontWeight: '500',
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  bodySecondary: {
    fontFamily: fonts.body,
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  label: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  caption: {
    fontFamily: fonts.body,
    fontWeight: '500',
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
};

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
  // Replaces hard card borders with a soft, diffuse lift.
  soft: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 4,
  },
  // Colored glow for the single strongest CTA on a screen (e.g. the Wardrobe
  // Hub's "Add Item") — a step above `soft`'s neutral lift, so the primary
  // action reads as heavier than the glass cards around it at a glance.
  accent: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 6,
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
// v2 buttons) define their own local style rather than overriding these —
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
    fontSize: 16,
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
    fontSize: 16,
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
    fontSize: 16,
  },
  disabled: { opacity: opacity.disabled },
};
