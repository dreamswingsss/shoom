import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useUserStore } from '../store/useUserStore';
import { colors, spacing, radius, fonts } from '../theme/tokens';

// Splash entrance — title, subtitle, and CTA rise + fade in as a staggered
// cascade (each ~120ms after the previous) rather than one flat block
// fading in together, so the screen reads as a deliberate reveal instead of
// a single static pop. Opacity always uses `withTiming` (a spring on
// opacity can overshoot past 1, which looks like a flicker); the vertical
// rise uses `withSpring` instead, so each element visibly settles with a
// touch of overshoot — the "pружинить" bounce — instead of arriving dead-on.
const SPLASH_ENTRANCE_STAGGER_MS = 120;
const SPLASH_FADE_MS = 420;
const SPLASH_RISE_DISTANCE = 22;
const SPLASH_RISE_SPRING = { damping: 14, stiffness: 140, mass: 0.7 };
// A quiet "breathing" loop on the CTA (scale only, no color/opacity flash),
// picking up once the CTA's own entrance has settled.
const SPLASH_CTA_PULSE_DELAY_MS = 900;
const SPLASH_CTA_PULSE_DURATION_MS = 1100;
const SPLASH_CTA_PULSE_SCALE = 1.02;

// Twinkling stars — each of the 3 decorative stars gets its own delay AND
// duration (not just a shared loop staggered by delay alone), so they never
// fall into a synchronized pulse together even after several cycles the way
// same-duration-different-delay loops eventually re-align on their least
// common multiple. Values are per-star props on SplashStar below, not one
// shared constant.

// v7 — the mockup's splash background (`#EAE7DE`) turned out to be the
// mockup's APP-WIDE background too (`var bg`, used on every screen's outer
// wrapper, confirmed by clicking through Home/Planner/Stylist/Profile), not
// a splash-only hero color — so `colors.background` (theme/tokens.js) now
// carries this same value and this file just reads it, instead of
// duplicating the literal hex.
const SPLASH_BG = colors.background;
// Approximates the mockup's radial-gradient wash (`splashWashStyle`:
// `#C6D6E6 -> sky (#A5BCD6) -> transparent`, blurred) as one flat soft-edged
// blob — React Native has no radial-gradient primitive without an SVG
// gradient def, and a single mid-tone circle behind the stamp reads close
// enough for a decorative backdrop glow at this size. `colors.sky` itself
// IS one of the mockup's own gradient stops (not just an approximation of
// one), so this now repaints automatically with any future palette pass
// instead of needing its own hardcoded hex re-derived by hand each time.
const SPLASH_WASH_COLOR = colors.sky;

// Entry point for a brand new install — the splash, and NOTHING else.
// "Get Started" -> useUserStore's `completeWelcome()` -> App.js's
// `needsOnboarding` gate flips straight to TabNavigator, where
// WardrobeScreen's own App Tour auto-start effect picks up the walkthrough
// (see that screen's own comment).
//
// Critical Change: this used to also ask for `gender` (a single chip-step
// after the splash) before handing off — that's gone. No parameter is
// collected here, gender included; every one of them (gender, body shape,
// hair/eye/skin color) is now asked inside RegistrationFlow, in one place,
// only the first time a guest actually tries to save a scanned item (see
// ScanSheet's own comment). Gating App.js's routing on `gender` the way it
// used to would have stranded every guest here forever, since nothing on
// this screen sets it anymore — that's why the gate moved to its own
// dedicated `hasCompletedWelcome` flag instead (see useUserStore.js).
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const completeWelcome = useUserStore((state) => state.completeWelcome);
  const insets = useSafeAreaInsets();

  // Two progress values PER element (opacity + rise), instead of one
  // shared `entrance` — each pair starts `SPLASH_ENTRANCE_STAGGER_MS` after
  // the previous element's, so the screen reveals as a cascade (title
  // first, then the subtitle sliding up under it, then the button) rather
  // than every element arriving in lockstep. Opacity is driven by
  // `withTiming` (linear fade — a spring here can overshoot past 1, which
  // reads as a flicker); rise is driven by `withSpring`, started ONCE per
  // element in the effect below and then just interpolated inside
  // `useAnimatedStyle` — calling `withSpring` itself from inside a derived
  // style would re-trigger a brand new spring on every intermediate frame
  // of that style's own dependency, never actually settling.
  const titleOpacity = useSharedValue(0);
  const titleRise = useSharedValue(0);
  const subtitleOpacity = useSharedValue(0);
  const subtitleRise = useSharedValue(0);
  const ctaOpacity = useSharedValue(0);
  const ctaRise = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    titleOpacity.value = withTiming(1, { duration: SPLASH_FADE_MS, easing: Easing.out(Easing.cubic) });
    titleRise.value = withSpring(1, SPLASH_RISE_SPRING);

    subtitleOpacity.value = withDelay(
      SPLASH_ENTRANCE_STAGGER_MS,
      withTiming(1, { duration: SPLASH_FADE_MS, easing: Easing.out(Easing.cubic) })
    );
    subtitleRise.value = withDelay(SPLASH_ENTRANCE_STAGGER_MS, withSpring(1, SPLASH_RISE_SPRING));

    ctaOpacity.value = withDelay(
      SPLASH_ENTRANCE_STAGGER_MS * 2,
      withTiming(1, { duration: SPLASH_FADE_MS, easing: Easing.out(Easing.cubic) })
    );
    ctaRise.value = withDelay(SPLASH_ENTRANCE_STAGGER_MS * 2, withSpring(1, SPLASH_RISE_SPRING));

    pulse.value = withDelay(
      SPLASH_CTA_PULSE_DELAY_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: SPLASH_CTA_PULSE_DURATION_MS, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: SPLASH_CTA_PULSE_DURATION_MS, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: (1 - titleRise.value) * SPLASH_RISE_DISTANCE }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: (1 - subtitleRise.value) * SPLASH_RISE_DISTANCE }],
  }));
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: (1 - ctaRise.value) * SPLASH_RISE_DISTANCE }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * (SPLASH_CTA_PULSE_SCALE - 1) }],
  }));

  return (
    <View style={styles.splashRoot}>
      <View style={styles.splashWash} pointerEvents="none" />
      <SplashStar
        size={34}
        color={colors.coral}
        style={[styles.splashStarBase, styles.splashStar1]}
        delay={0}
        duration={1500}
      />
      <SplashStar
        size={22}
        color={colors.coral}
        style={[styles.splashStarBase, styles.splashStar2]}
        delay={550}
        duration={1850}
        maxOpacity={0.9}
      />
      <SplashStar
        size={16}
        color={colors.textPrimary}
        style={[styles.splashStarBase, styles.splashStar3]}
        delay={1000}
        duration={1300}
        maxOpacity={0.85}
      />
      <View style={styles.splashDot} pointerEvents="none" />

      <View style={[styles.splashSafe, { paddingBottom: spacing.lg + insets.bottom }]}>
        <View style={styles.splashSpacer} />

        <View style={styles.splashStamp}>
          <Animated.Text
            style={[styles.splashWordmark, titleStyle]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
          >
            {t('onboarding.splashWordmark')}
          </Animated.Text>
          <Animated.View style={[styles.splashRule, titleStyle]} />
          <Animated.Text style={[styles.splashTagline, subtitleStyle]}>
            {t('onboarding.splashTagline')}
          </Animated.Text>
        </View>

        <View style={styles.splashSpacer} />

        <Animated.View style={[ctaStyle, pulseStyle]}>
          <TouchableOpacity
            onPress={completeWelcome}
            activeOpacity={0.85}
            style={styles.splashCtaBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.splashCtaBtnText}>{t('onboarding.buttons.getStarted')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

// Five-point star decoration — the mockup's exact SVG path, plus its own
// perpetual twinkle: opacity eases up to `maxOpacity` and back down to
// `minOpacity` in an endless loop (`withRepeat(..., -1, false)` — `false`
// means it restarts from the beginning each cycle rather than reversing
// in place, but since the sequence already ends back where it started
// (1 -> 0), the restart is seamless). `delay` offsets each star's loop
// start so three stars with the SAME duration would still desync, and
// `duration` differs per call site too (see the three call sites below) so
// they never fall into a shared rhythm even after several cycles.
// `Svg` itself isn't an Animated-capable component, so the opacity lives on
// a wrapping `Animated.View` instead — this also carries the star's own
// position (`style`, e.g. `splashStar1`), same as the plain `Svg`'s `style`
// prop used to.
function SplashStar({ size, color, style, delay = 0, duration = 1400, minOpacity = 0.2, maxOpacity = 1 }) {
  const twinkle = useSharedValue(0);

  useEffect(() => {
    twinkle.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const twinkleStyle = useAnimatedStyle(() => ({
    opacity: minOpacity + twinkle.value * (maxOpacity - minOpacity),
  }));

  return (
    <Animated.View style={[style, twinkleStyle]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 1l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L1.7 8.2l7.1-.6z" fill={color} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  splashRoot: { flex: 1, backgroundColor: SPLASH_BG, overflow: 'hidden' },
  // Positioned/sized off the mockup's own radial wash box (top:-40px,
  // left/right:-30px, height:58% before blur) — shrunk slightly since this
  // is a flat color standing in for a soft blurred gradient, not the
  // gradient itself, so a smaller/softer footprint reads closer to the
  // original's blurred edge than matching its box exactly would.
  splashWash: {
    position: 'absolute',
    top: -90,
    left: -60,
    right: -60,
    height: '42%',
    borderRadius: 999,
    backgroundColor: SPLASH_WASH_COLOR,
    opacity: 0.5,
  },
  // No static `opacity` here anymore — each star's own SplashStar instance
  // now animates opacity continuously (see that component's own comment),
  // with the SAME peak values (`maxOpacity` at the call site) these used to
  // hardcode, so the "star3 is dimmer than star1" hierarchy is unchanged.
  splashStarBase: { position: 'absolute' },
  splashStar1: { top: 92, right: 40 },
  splashStar2: { top: 150, left: 34 },
  splashStar3: { top: 250, right: 58 },
  splashDot: {
    position: 'absolute',
    top: 128,
    right: 96,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.coral,
  },
  // paddingBottom set inline above, from a fixed gap + the real bottom
  // safe-area inset (this screen bleeds under the status bar on purpose —
  // see the mockup's own `margin:-52px 0 0` — so it manages its own inset
  // instead of going through ScreenContainer).
  splashSafe: { flex: 1, paddingTop: 72, paddingHorizontal: 30 },
  splashSpacer: { flex: 1 },
  splashStamp: { alignItems: 'center' },
  // Manrope substitute for the mockup's Anton — Anton is a font this app
  // doesn't load. Sized up from the previous 52px (the same weight/family
  // RegistrationFlow's own `stepTitle` uses — `fonts.display` at 800 — just
  // pushed further here since exactly one wordmark is ever on screen,
  // unlike RegistrationFlow's own 26px cap which has to share the screen
  // with a progress bar and answer grid below it) with wider tracking for
  // a more deliberate, premium wordmark read; `adjustsFontSizeToFit` stays
  // as the safety net for long translated strings.
  splashWordmark: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 64,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.textPrimary,
    maxWidth: '100%',
  },
  splashRule: { width: 46, height: 2, backgroundColor: colors.textPrimary, marginTop: 12, marginBottom: 4 },
  // Un-italicized (was italic pre-redesign) — still the serif accent
  // (`fonts.serif`) that gives this screen its own boutique character
  // rather than flattening into RegistrationFlow's all-Manrope look, but
  // upright reads as more confident/legible than italic at this size.
  // fontSize/lineHeight/maxWidth tuned down from an earlier single-line-ish
  // pass (23px/290) to fit the new, deliberately longer tagline copy (see
  // `onboarding.splashTagline`, locales/en.json) — a substantial 3-clause
  // sentence needs a bit more width and a bit less size to read as an
  // inviting paragraph instead of a cramped block.
  //
  // ALTERNATIVE COPY (not used — pick one of these instead of the current
  // en.json string if this exact phrasing isn't the right fit):
  //   "Snap your clothes, uncover outfits you'd never have paired
  //   yourself, and let AI dress you perfectly for your mood, your style,
  //   and today's forecast."
  //   "From closet to calendar — digitize what you own, explore fresh
  //   combinations, and let your AI stylist curate the ideal outfit for
  //   you, rain or shine."
  splashTagline: {
    fontFamily: fonts.serif,
    fontStyle: 'normal',
    fontWeight: '600',
    fontSize: 18,
    lineHeight: 26,
    color: colors.textPrimary,
    maxWidth: 320,
    textAlign: 'center',
    marginTop: 20,
  },
  // Full pill (radius.pill = 999).
  splashCtaBtn: {
    width: '100%',
    backgroundColor: colors.textPrimary,
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashCtaBtnText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: SPLASH_BG,
  },
});
