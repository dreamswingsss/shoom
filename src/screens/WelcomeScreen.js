import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FadeInView } from '../components/AnimatedPressable';
import { useUserStore } from '../store/useUserStore';
import { colors, spacing, radius, fonts, typography } from '../theme/tokens';

const SPLASH_BG = colors.background;

// Entry point for a brand new install — a 3-step full-screen intro
// carousel, one feature per step (color type / body shape / real stylist
// advice), landing straight on step 1 the moment the app opens. This
// replaced an earlier 2-screen flow (a standalone logo/tagline splash,
// then all 3 features crammed onto one second screen) — the standalone
// splash added a step with nothing to actually read before the pitch
// even started, and cramming 3 features onto one screen meant none of
// them got room to breathe. No App Tour walkthrough afterward (that
// coach-mark tour was retired — see WardrobeScreen.js's own comment).
// Only the last step's button calls `completeWelcome()` -> App.js's
// `needsOnboarding` gate flips straight to TabNavigator; every earlier
// step just advances local `step` state, nothing persisted yet. "Skip"
// (top-right, every step) also calls `completeWelcome()` directly,
// bypassing whatever's left.
//
// No parameter is collected here, gender included — every one of them
// (gender, body shape, hair/eye/skin color) is asked inside
// RegistrationFlow, in one place, only the first time a guest actually
// tries to save a scanned item (see ScanSheet's own comment). Gating
// App.js's routing on any of those fields would strand a guest here
// forever, since nothing on this screen sets them — that's why the gate
// is its own dedicated `hasCompletedWelcome` flag (see useUserStore.js).
const STEPS = [
  { icon: 'droplet', titleKey: 'step1Title', textKey: 'step1Text' },
  { icon: 'user', titleKey: 'step2Title', textKey: 'step2Text' },
  { icon: 'award', titleKey: 'step3Title', textKey: 'step3Text' },
];

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const completeWelcome = useUserStore((state) => state.completeWelcome);
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  function handleNext() {
    if (isLastStep) {
      completeWelcome();
      return;
    }
    setStepIndex((prev) => prev + 1);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: spacing.lg + insets.bottom }]}>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Feather name="zap" size={12} color={colors.inverseText} />
          </View>
          <Text style={styles.brandWordmark}>{t('onboarding.splashWordmark')}</Text>
        </View>
        <TouchableOpacity onPress={completeWelcome} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.skipText}>{t('onboarding.intro.skip')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <FadeInView key={stepIndex} delay={0}>
          <Text style={styles.stepNumber}>{String(stepIndex + 1).padStart(2, '0')}</Text>
          <View style={styles.stepIconWrap}>
            <Feather name={step.icon} size={22} color={colors.inverseText} />
          </View>
          <Text style={styles.stepTitle}>{t(`onboarding.intro.${step.titleKey}`)}</Text>
          <Text style={styles.stepText}>{t(`onboarding.intro.${step.textKey}`)}</Text>
        </FadeInView>
      </View>

      <View style={styles.progressRow}>
        {STEPS.map((_, index) => (
          <View
            key={index}
            style={[
              styles.progressDot,
              index === stepIndex && styles.progressDotActive,
              index < stepIndex && styles.progressDotDone,
            ]}
          />
        ))}
      </View>

      <TouchableOpacity
        onPress={handleNext}
        activeOpacity={0.85}
        style={styles.ctaBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.ctaBtnText}>
          {isLastStep ? t('onboarding.buttons.getStarted') : t('onboarding.intro.next')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BG, paddingHorizontal: 30 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandWordmark: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textPrimary,
  },
  skipText: { ...typography.bodySecondary, fontWeight: '600' },

  // Vertically centered content block — each step's number/icon/title/text
  // lands in the same spot as the last, so advancing steps reads as a
  // straight swap, not content jumping around the screen.
  body: { flex: 1, justifyContent: 'center' },
  stepNumber: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 56,
    color: colors.border,
    marginBottom: spacing.md,
  },
  stepIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  stepTitle: { ...typography.h1, marginBottom: spacing.xs },
  stepText: { ...typography.bodySecondary, fontSize: 15, lineHeight: 22, maxWidth: 320 },

  progressRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  progressDotDone: { backgroundColor: colors.textPrimary, opacity: 0.35 },
  progressDotActive: { backgroundColor: colors.textPrimary, width: 20 },

  ctaBtn: {
    width: '100%',
    backgroundColor: colors.textPrimary,
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: SPLASH_BG,
  },
});
