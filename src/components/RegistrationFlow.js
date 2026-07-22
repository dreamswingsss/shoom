import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import BodyShapeSelector from './BodyShapeSelector';
import ColorSwatchPicker from './ColorSwatchPicker';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
import {
  GENDERS,
  getBodyTypeOptions,
  getHairColorOptions,
  EYE_COLORS,
  SKIN_TONES,
  filterDigits,
} from '../constants/profileOptions';
import { colors, spacing, radius, typography, buttons, opacity as opacityTokens } from '../theme/tokens';

const HEIGHT_MIN_CM = 90;
const HEIGHT_MAX_CM = 250;
const WEIGHT_MIN_KG = 20;
const WEIGHT_MAX_KG = 300;

const TRANSITION_DURATION = 320;
const SLIDE_DISTANCE = 32;
const TRANSITION_EASING = Easing.bezier(0.4, 0, 0.2, 1);

const PARAM_STEP_KEYS = ['gender', 'measurements', 'bodyType', 'hairColor', 'eyeColor', 'skinTone'];

// Display-only for now (see the measurements step's own comment) — 'metric'
// is what every existing validation/save path already assumes.
const UNIT_SYSTEMS = ['metric', 'imperial'];

// Step-by-step registration — the parameter-collection half of ScanSheet's
// deferred-registration flow (see that component's own comment for the
// full guest -> params -> Google handoff this feeds into). Everything here
// is LOCAL component state, never written to useUserStore, until this
// actually succeeds — a guest who backs out mid-flow leaves zero trace in
// the store, same as if they'd never opened this. Gender included — this is
// now the ONLY place the app ever asks for it (WelcomeScreen's splash asks
// for nothing at all, see that file's own comment), so it's the flow's own
// first step rather than a prop the caller is expected to already have.
//
// Google is deliberately the LAST step, not the first (the reverse of how
// this used to work): the client answers every question BEFORE ever being
// asked to create an account, so account creation reads as "one tap to
// save everything I just told you" rather than a wall up front with a
// form to fill in afterwards.
//
// FULL-SCREEN, not a BottomSheet — a client this deep into account creation
// (parameters already answered, one tap from a real account) shouldn't feel
// like they're still filling out "one more layer" of the same sheet ScanSheet
// opened; a real Modal (`presentationStyle="fullScreen"`, standard slide-up
// transition) reads as its own dedicated moment, fully covering the Closet
// UI behind it rather than peeking around a rounded sheet edge.
//
// `initialGender` — set only for a client who somehow already has a gender
// on file (the rarer already-signed-in-but-uncalibrated case below, if
// THEY happen to have one from some other path); the gender step is
// skipped entirely when present, same "don't re-ask what's already known"
// rule ScanSheet's own `needsCalibration` follows for every other field.
//
// `isLoggedIn` — true for the rarer case of a client who already has a
// session (e.g. signed in earlier via ProfileScreen's own guest CTA,
// without ever going through THIS flow) but still hasn't filled in these
// fields. No account to create at that point, so the Google step is
// dropped entirely and the last param step's own Continue button calls
// `onSuccess` directly instead of a Google button doing it.
export default function RegistrationFlow({ visible, onClose, initialGender, isLoggedIn, onSuccess }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { signIn, signingIn, error: googleError, setError: setGoogleError } = useGoogleSignIn();
  const paramStepKeys = initialGender ? PARAM_STEP_KEYS.filter((key) => key !== 'gender') : PARAM_STEP_KEYS;
  const stepKeys = isLoggedIn ? paramStepKeys : [...paramStepKeys, 'google'];

  const [stepIndex, setStepIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  // Seeded with a smart default (same reasoning the old WelcomeScreen
  // gender step used) so the gender step never reads as blank the instant
  // it mounts — the client can still change it before continuing.
  const [genderValue, setGenderValue] = useState(initialGender || GENDERS[0]);
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  // Purely a display toggle right now — every input still collects (and
  // `heightOutOfRange`/`weightOutOfRange` still validate) plain metric
  // numbers regardless of which system is selected. Wiring an actual
  // cm<->ft/in and kg<->lbs conversion (both on entry and on the stored
  // value) is real follow-up work, not something to fake here; the
  // selector's job for now is just to exist and hold state, per what was
  // asked for.
  const [unitSystem, setUnitSystem] = useState('metric');
  const [bodyTypeValue, setBodyTypeValue] = useState(null);
  const [hairColorValue, setHairColorValue] = useState(null);
  const [eyeColorValue, setEyeColorValue] = useState(null);
  const [skinToneValue, setSkinToneValue] = useState(null);

  const contentOpacity = useSharedValue(1);
  const contentTranslateX = useSharedValue(0);

  // Fresh slate every time this opens — not on close, so the closing
  // animation doesn't visibly flash back to step 0 first (same pattern as
  // ScanSheet's own reset-on-visible effect).
  useEffect(() => {
    if (visible) {
      setStepIndex(0);
      setIsTransitioning(false);
      setGenderValue(initialGender || GENDERS[0]);
      setHeightInput('');
      setWeightInput('');
      setUnitSystem('metric');
      setBodyTypeValue(null);
      setHairColorValue(null);
      setEyeColorValue(null);
      setSkinToneValue(null);
      setGoogleError(null);
      contentOpacity.value = 1;
      contentTranslateX.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialGender]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateX: contentTranslateX.value }],
  }));

  const heightValue = Number(heightInput);
  const weightValue = Number(weightInput);
  const heightOutOfRange = heightInput.length > 0 && (heightValue < HEIGHT_MIN_CM || heightValue > HEIGHT_MAX_CM);
  const weightOutOfRange = weightInput.length > 0 && (weightValue < WEIGHT_MIN_KG || weightValue > WEIGHT_MAX_KG);

  const stepKey = stepKeys[stepIndex];
  const isLastStep = stepIndex === stepKeys.length - 1;
  const progressPercent = Math.round(((stepIndex + 1) / stepKeys.length) * 100);

  // Whether the CURRENT step has a valid enough answer to move on — the
  // bottom Continue button (every step except the final Google one, which
  // has its own button) stays disabled until this is true. `gender` isn't
  // listed — it's pre-seeded with a default (see genderValue's own
  // comment), so it's always ready without an explicit tap, same as the
  // old WelcomeScreen step it replaces.
  let stepReady = true;
  if (stepKey === 'measurements') {
    stepReady = heightInput.length > 0 && weightInput.length > 0 && !heightOutOfRange && !weightOutOfRange;
  } else if (stepKey === 'bodyType') {
    stepReady = Boolean(bodyTypeValue);
  } else if (stepKey === 'hairColor') {
    stepReady = Boolean(hairColorValue);
  } else if (stepKey === 'eyeColor') {
    stepReady = Boolean(eyeColorValue);
  } else if (stepKey === 'skinTone') {
    stepReady = Boolean(skinToneValue);
  }

  function advanceStep() {
    setStepIndex((prev) => prev + 1);
    contentTranslateX.value = SLIDE_DISTANCE;
    contentOpacity.value = 0;
    contentOpacity.value = withTiming(1, { duration: TRANSITION_DURATION, easing: TRANSITION_EASING });
    contentTranslateX.value = withTiming(0, { duration: TRANSITION_DURATION, easing: TRANSITION_EASING });
    setIsTransitioning(false);
  }

  function retreatStep() {
    setStepIndex((prev) => Math.max(0, prev - 1));
    contentTranslateX.value = -SLIDE_DISTANCE;
    contentOpacity.value = 0;
    contentOpacity.value = withTiming(1, { duration: TRANSITION_DURATION, easing: TRANSITION_EASING });
    contentTranslateX.value = withTiming(0, { duration: TRANSITION_DURATION, easing: TRANSITION_EASING });
    setIsTransitioning(false);
  }

  // What's been collected so far, in the shape ScanSheet's onSuccess (->
  // completeOnboarding) expects.
  function collectedProfileData() {
    return {
      gender: genderValue,
      height: heightValue,
      weight: weightValue,
      bodyType: bodyTypeValue,
      hairColor: hairColorValue,
      eyeColor: eyeColorValue,
      skinTone: skinToneValue,
    };
  }

  function handleContinue() {
    if (isTransitioning || !stepReady) return;

    // Only reachable when `isLoggedIn` (the Continue button is hidden on
    // the 'google' step, which is the guest path's own true last step —
    // see the render below) — no account left to create, so this step's
    // own Continue IS the finish action.
    if (isLastStep) {
      onSuccess(collectedProfileData());
      return;
    }

    setIsTransitioning(true);
    contentOpacity.value = withTiming(0, { duration: TRANSITION_DURATION, easing: TRANSITION_EASING });
    contentTranslateX.value = withTiming(
      -SLIDE_DISTANCE,
      { duration: TRANSITION_DURATION, easing: TRANSITION_EASING },
      (finished) => {
        if (finished) runOnJS(advanceStep)();
      }
    );
  }

  function handleBack() {
    if (isTransitioning || stepIndex === 0) return;
    setIsTransitioning(true);
    contentOpacity.value = withTiming(0, { duration: TRANSITION_DURATION, easing: TRANSITION_EASING });
    contentTranslateX.value = withTiming(
      SLIDE_DISTANCE,
      { duration: TRANSITION_DURATION, easing: TRANSITION_EASING },
      (finished) => {
        if (finished) runOnJS(retreatStep)();
      }
    );
  }

  // The actual account-creation moment — everything collected across every
  // PREVIOUS step (still just local component state) is handed to the
  // caller only once this succeeds. ScanSheet's own onSuccess handler is
  // what turns this into a real `completeOnboarding` + save.
  async function handleGooglePress() {
    const result = await signIn();
    if (result.status !== 'success') return;
    onSuccess(collectedProfileData());
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.header}>
          {stepIndex > 0 ? (
            <TouchableOpacity
              onPress={handleBack}
              disabled={isTransitioning}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="chevron-left" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="x" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scrollWrap} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.contentFlex, contentStyle]}>
            {stepKey === 'gender' && (
              <View style={styles.stepBlock}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.gender')}</Text>
                <View style={styles.genderChipWrap}>
                  {GENDERS.map((option) => {
                    const isSelected = genderValue === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[styles.genderChip, isSelected && styles.genderChipSelected]}
                        onPress={() => setGenderValue(option)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.genderChipText, isSelected && styles.genderChipTextSelected]}>
                          {t(`onboarding.options.${option}`, option)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {stepKey === 'measurements' && (
              <View style={styles.stepBlock}>
                <Text style={styles.stepTitle}>{t('closet.scan.registration.heightWeightTitle')}</Text>
                <Text style={styles.stepSubtitle}>{t('closet.scan.calibration.subtitle')}</Text>

                {/* Metric/imperial toggle — display-only for now, see
                    `unitSystem`'s own comment above for why the fields
                    themselves don't convert yet. */}
                <View style={styles.unitToggleWrap}>
                  {UNIT_SYSTEMS.map((system) => {
                    const isSelected = unitSystem === system;
                    const label =
                      system === 'metric'
                        ? `${t('common.units.cm')} / ${t('common.units.kg')}`
                        : `${t('common.units.ft')} / ${t('common.units.lbs')}`;
                    return (
                      <TouchableOpacity
                        key={system}
                        style={[styles.unitToggleOption, isSelected && styles.unitToggleOptionSelected]}
                        onPress={() => setUnitSystem(system)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.unitToggleText, isSelected && styles.unitToggleTextSelected]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.fieldsRow}>
                  <View style={styles.field}>
                    <View style={styles.inputRow}>
                      <TextInput
                        style={styles.input}
                        value={heightInput}
                        onChangeText={(text) => setHeightInput(filterDigits(text))}
                        keyboardType="numeric"
                        maxLength={3}
                        placeholder={t('closet.scan.calibration.heightPlaceholder')}
                        placeholderTextColor={colors.textMuted}
                      />
                      {heightInput.length > 0 && (
                        <Text style={styles.inputUnit}>
                          {t(unitSystem === 'metric' ? 'common.units.cm' : 'common.units.ft')}
                        </Text>
                      )}
                    </View>
                    {heightOutOfRange && (
                      <Text style={styles.fieldError}>{t('closet.scan.calibration.heightError')}</Text>
                    )}
                  </View>

                  <View style={styles.field}>
                    <View style={styles.inputRow}>
                      <TextInput
                        style={styles.input}
                        value={weightInput}
                        onChangeText={(text) => setWeightInput(filterDigits(text))}
                        keyboardType="numeric"
                        maxLength={3}
                        placeholder={t('closet.scan.calibration.weightPlaceholder')}
                        placeholderTextColor={colors.textMuted}
                      />
                      {weightInput.length > 0 && (
                        <Text style={styles.inputUnit}>
                          {t(unitSystem === 'metric' ? 'common.units.kg' : 'common.units.lbs')}
                        </Text>
                      )}
                    </View>
                    {weightOutOfRange && (
                      <Text style={styles.fieldError}>{t('closet.scan.calibration.weightError')}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {stepKey === 'bodyType' && (
              <View style={styles.stepBlock}>
                {/* Title rendered here (not passed as BodyShapeSelector's own
                    `label`) so it shares the exact same big/bold/centered
                    `stepTitle` style every other step uses — that component's
                    own `sectionLabel` is deliberately small/muted/uppercase
                    for its OTHER caller (EditProfileScreen, which stacks
                    several of these back to back as compact form sections),
                    which is exactly the "small grey caps" look this flow
                    doesn't want. */}
                <Text style={styles.stepTitle}>{t('onboarding.steps.bodyType')}</Text>
                <BodyShapeSelector
                  options={getBodyTypeOptions(genderValue)}
                  value={bodyTypeValue}
                  onChange={setBodyTypeValue}
                />
              </View>
            )}

            {stepKey === 'hairColor' && (
              <View style={styles.stepBlock}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.hairColor')}</Text>
                <ColorSwatchPicker
                  options={getHairColorOptions(genderValue)}
                  value={hairColorValue}
                  onChange={setHairColorValue}
                  swatchStyle="hair"
                  center
                  columns={3}
                />
              </View>
            )}

            {stepKey === 'eyeColor' && (
              <View style={styles.stepBlock}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.eyeColor')}</Text>
                <ColorSwatchPicker
                  options={EYE_COLORS}
                  value={eyeColorValue}
                  onChange={setEyeColorValue}
                  swatchStyle="eye"
                  center
                  columns={3}
                />
              </View>
            )}

            {stepKey === 'skinTone' && (
              <View style={styles.stepBlock}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.skinTone')}</Text>
                <ColorSwatchPicker
                  options={SKIN_TONES}
                  value={skinToneValue}
                  onChange={setSkinToneValue}
                  swatchStyle="flat"
                  center
                  columns={3}
                />
              </View>
            )}

            {stepKey === 'google' && (
              <View style={[styles.stepBlock, styles.googleStepBlock]}>
                <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.googleIconWrap}>
                  <Feather name="check" size={26} color={colors.inverseText} />
                </LinearGradient>
                <Text style={[styles.stepTitle, styles.googleStepTitle]}>
                  {t('closet.scan.registration.finalTitle')}
                </Text>
                <Text style={[styles.stepSubtitle, styles.googleStepSubtitle]}>
                  {t('closet.scan.registration.finalSubtitle')}
                </Text>

                {googleError && (
                  <Text style={styles.googleErrorText}>
                    {googleError.message || t('closet.scan.authPrompt.genericError')}
                  </Text>
                )}

                <TouchableOpacity
                  style={[styles.googleBtn, signingIn && styles.actionBtnDisabled]}
                  onPress={handleGooglePress}
                  disabled={signingIn}
                  activeOpacity={0.85}
                >
                  {signingIn ? (
                    <ActivityIndicator size="small" color={colors.inverseText} />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="google" size={20} color={colors.inverseText} />
                      <Text style={styles.googleBtnText}>{t('closet.scan.authPrompt.googleButton')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {stepKey !== 'google' && (
          <TouchableOpacity
            style={[buttons.primary, !stepReady && buttons.disabled, styles.continueBtn]}
            onPress={handleContinue}
            disabled={!stepReady || isTransitioning}
            activeOpacity={0.85}
          >
            <Text style={buttons.primaryText}>
              {isLastStep ? t('onboarding.buttons.finish') : t('onboarding.buttons.continue')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Full-screen root — replaces BottomSheet's own rounded-top sheet
  // surface. `colors.background` (not `colors.surface`) so this reads as a
  // distinct, dedicated screen rather than a raised card floating over the
  // app, matching the mockup's own full-screen registration flow.
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  headerSpacer: { width: 22 },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },

  // `flex: 1` on both the ScrollView itself and its animated content
  // wrapper — without a bounded height to grow into, `scrollWrap`'s own
  // `flexGrow: 1` below is a no-op (flexGrow only matters once the
  // ScrollView's OWN box is actually constrained), which is why the final
  // "Create your account" step used to render pinned to the top instead of
  // centered: nothing anywhere in this chain was actually filling the
  // screen's real height, so `googleStepBlock`'s own `justifyContent:
  // 'center'` had nothing but its own `minHeight` to center within.
  scrollFlex: { flex: 1 },
  contentFlex: { flex: 1 },
  scrollWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, flexGrow: 1 },
  // `flex: 1` (on top of the old `minHeight` floor, kept as a safety net
  // for a step shorter than the screen) is what lets the final step's
  // `googleStepBlock` truly center within the full available height instead
  // of just its own 280px minimum — see `scrollFlex`'s own comment above.
  // Every other step still renders top-down as before: none of them set a
  // `justifyContent` of their own, so filling extra vertical space here
  // doesn't shift their content, it just gives the LAST step something
  // real to center inside.
  stepBlock: { flex: 1, minHeight: 320 },
  // Large, bold, black, and centered on every step (gender, measurements,
  // body shape, hair/eye color, skin tone — every question this flow asks)
  // — a small, grey, ALL-CAPS `typography.label` (BodyShapeSelector's and
  // ColorSwatchPicker's own default `sectionLabel`, meant for
  // EditProfileScreen's compact stacked form) read as an afterthought next
  // to the big centered answer grids below it, and directly caused the
  // "WHAT IS YOUR HAIR COLOR?" look — that's `textTransform: 'uppercase'`
  // acting on an already-sentence-case translation string, not the string
  // itself shouting. `marginTop: 40` clears the progress bar above.
  stepTitle: {
    ...typography.h2,
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    color: colors.textPrimary,
    marginTop: 40,
    marginBottom: spacing.xs,
  },
  stepSubtitle: { ...typography.bodySecondary, fontSize: 14, textAlign: 'center', marginBottom: spacing.md },

  // Gender step's answer grid. `justifyContent: 'center'` + `gap` (not the
  // old `space-between` + `rowGap`) is what actually keeps this symmetric
  // regardless of how many options there are — `space-between` only reads
  // as centered when a row happens to fill completely; GENDERS has 3
  // options, so the last row (1 chip) used to get shoved flush left with a
  // big empty gap beside it instead of sitting centered under the two above.
  genderChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  genderChip: {
    flexBasis: '40%',
    flexGrow: 1,
    maxWidth: 160,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  genderChipSelected: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  genderChipText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  genderChipTextSelected: { color: colors.inverseText },

  // Measurements step's metric/imperial segmented toggle.
  unitToggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  unitToggleOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  unitToggleOptionSelected: { backgroundColor: colors.inverseBackground },
  unitToggleText: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
  unitToggleTextSelected: { color: colors.inverseText },

  // Stacked, not side-by-side — height's own unit (cm or ft, whichever
  // `unitSystem` picked) sits directly above weight's (kg or lbs), both
  // centered under the title, instead of the old cramped 2-up row. Field
  // order in the JSX below never changes (height field first, weight
  // field second) — that already matches "cm above kg" AND "ft above lbs"
  // on its own, since height maps to cm/ft and weight maps to kg/lbs
  // regardless of which unit system is active.
  fieldsRow: { alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  field: { width: '60%', alignItems: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.xs },
  input: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: spacing.xs,
    minWidth: 80,
  },
  inputUnit: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.xs },
  fieldError: { fontSize: 11, color: colors.danger, marginTop: 4, textAlign: 'center' },

  // Floating, not edge-to-edge — `width: '90%'` + `alignSelf: 'center'`
  // (overriding `buttons.primary`'s own `width: '100%'`, which this style
  // object is spread AFTER in the style array) leaves clear side margins
  // instead of the pill running flush to both screen edges. `marginBottom`
  // sits on top of the root container's own safe-area bottom padding (see
  // the root View's inline style), so this never crowds the home
  // indicator either. Same style object on every non-Google step, so the
  // button reads identically regardless of which question is showing.
  continueBtn: { width: '90%', alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.sm },

  // Final step — same icon-chip/title/subtitle/CTA shape ScanSheet's old
  // auth prompt used, centered rather than left-aligned like the other steps.
  googleStepBlock: { alignItems: 'center', minHeight: 280, justifyContent: 'center' },
  googleIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.cardLg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  // Cancels stepTitle's own `marginTop: 40` for this one step — everything
  // in `googleStepBlock` (icon, title, subtitle, button) now centers as a
  // single group within the full screen height (see `stepBlock`'s own
  // comment), so an extra top margin baked into the title would just push
  // that whole centered group slightly below true center instead of
  // clearing a progress bar it isn't sitting under here.
  googleStepTitle: { textAlign: 'center', marginTop: 0 },
  googleStepSubtitle: { textAlign: 'center', paddingHorizontal: spacing.sm },
  googleErrorText: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    width: '100%',
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
  },
  googleBtnText: { ...buttons.primaryText, fontSize: 16 },
  actionBtnDisabled: { opacity: opacityTokens.disabled },
});
