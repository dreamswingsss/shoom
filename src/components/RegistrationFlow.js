import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import BodyShapeSelector from './BodyShapeSelector';
import ColorSwatchPicker from './ColorSwatchPicker';
import { useTelegramSignIn } from '../hooks/useTelegramSignIn';
import {
  GENDERS,
  getBodyTypeOptions,
  getHairColorOptions,
  EYE_COLORS,
  SKIN_TONES,
  STYLE_VIBES,
  MAX_STYLE_VIBES,
  filterDigits,
} from '../constants/profileOptions';
import { colors, spacing, radius, typography, buttons, opacity as opacityTokens } from '../theme/tokens';
import { scrollFieldIntoView } from '../utils/scrollFieldIntoView';

const HEIGHT_MIN_CM = 90;
const HEIGHT_MAX_CM = 250;
const WEIGHT_MIN_KG = 20;
const WEIGHT_MAX_KG = 300;

const TRANSITION_DURATION = 320;
const SLIDE_DISTANCE = 32;
const TRANSITION_EASING = Easing.bezier(0.4, 0, 0.2, 1);

// 'bodyMeasurements' (shoulders/chest/waist/hips) sits right after
// 'bodyType' — same relative position EditProfile groups it in. 'styleVibes'
// (chip multi-select) and 'stylePreferences' (free-text notes for the AI
// stylist) are deliberately the LAST two questions, right before 'google'
// (appended below, outside this array) — the client's already answered every
// concrete physical/appearance question by then, so the flow ends on the
// two "tell us about your taste" steps immediately before account creation,
// not buried in the middle. All three are "(Optional)"/no-placeholder-
// required per their own translated titles, so none of them gates
// `stepReady` below; a guest can Continue through any of them with nothing
// filled in.
// `styleVibes` and `stylePreferences` are two DIFFERENT fields on
// useUserStore (an array of chip picks vs. a free-text string) that happen
// to share a very similar name — keeping them as two separate step keys,
// each named after the field it actually collects, is what keeps that
// straight in the render below (and in collectedProfileData).
const PARAM_STEP_KEYS = [
  'gender',
  'measurements',
  'bodyType',
  'bodyMeasurements',
  'hairColor',
  'eyeColor',
  'skinTone',
  'styleVibes',
  'stylePreferences',
];

// Display-only for now (see the measurements step's own comment) — 'metric'
// is what every existing validation/save path already assumes.
const UNIT_SYSTEMS = ['metric', 'imperial'];

// Body Measurements step's own cm/in toggle — separate from UNIT_SYSTEMS
// above (that one's 'metric'/'imperial' covers height in ft/in *combined*
// and weight in lbs; shoulders/chest/waist/hips are always a single number
// in either cm or in, never a feet+inches pair), but the SAME "display-only,
// record which system was picked, don't convert the typed number" shape —
// see measurementUnitValue's own comment below.
const MEASUREMENT_UNITS = ['cm', 'in'];

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
  const { signIn, signingIn, error: googleError, setError: setGoogleError } = useTelegramSignIn();
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
  // Body Measurements step — same four fields, same keys (shoulders/chest/
  // waist/hips) as EditProfileScreen's own formShoulders/formChest/
  // formWaist/formHips, so collectedProfileData's `measurements` object
  // below lands in the exact shape completeOnboarding already expects
  // (see useUserStore.js's own `measurements` patch field) with zero store
  // changes needed.
  const [shouldersInput, setShouldersInput] = useState('');
  const [chestInput, setChestInput] = useState('');
  const [waistInput, setWaistInput] = useState('');
  const [hipsInput, setHipsInput] = useState('');
  // Which unit the four fields above were typed in — persisted alongside
  // `measurements` (see useUserStore's own `measurementUnit` field/
  // `measurement_unit` column) so the AI stylist prompt and any future real
  // conversion know how to read the raw numbers. Purely a label/record right
  // now, same as `unitSystem` above — switching it does NOT convert
  // whatever's already typed in the fields.
  const [measurementUnitValue, setMeasurementUnitValue] = useState('cm');
  // Style Vibes step — same STYLE_VIBES/MAX_STYLE_VIBES multi-select
  // EditProfileScreen's own StyleVibeSection uses, capped the same way.
  // Unlike EditProfileScreen's `styleVibes` (which commits to the store
  // immediately per tap via toggleStyleVibe), this stays local state like
  // every other field in this flow — nothing here writes to useUserStore
  // until the whole flow succeeds.
  const [styleVibesValue, setStyleVibesValue] = useState([]);
  // Style Preferences step — free-text notes for the AI stylist. Maps
  // directly onto useUserStore's existing `stylePreferences` string field
  // (same one EditProfileScreen's own free-text "Describe Your Style" box
  // writes to) — that field, its `completeOnboarding` patch entry, and its
  // `style_preferences` DB column already existed before this step did;
  // this is the first onboarding UI to actually populate it.
  const [stylePreferencesValue, setStylePreferencesValue] = useState('');
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
      setShouldersInput('');
      setChestInput('');
      setWaistInput('');
      setHipsInput('');
      setMeasurementUnitValue('cm');
      setStyleVibesValue([]);
      setStylePreferencesValue('');
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
      measurements: {
        shoulders: shouldersInput ? Number(shouldersInput) : null,
        chest: chestInput ? Number(chestInput) : null,
        waist: waistInput ? Number(waistInput) : null,
        hips: hipsInput ? Number(hipsInput) : null,
      },
      measurementUnit: measurementUnitValue,
      styleVibes: styleVibesValue,
      stylePreferences: stylePreferencesValue,
      hairColor: hairColorValue,
      eyeColor: eyeColorValue,
      skinTone: skinToneValue,
    };
  }

  // Same cap-and-toggle logic as useUserStore's own toggleStyleVibe, just
  // against local state instead of committing immediately — see
  // styleVibesValue's own comment above for why this one stays local.
  function toggleStyleVibe(vibe) {
    setStyleVibesValue((prev) => {
      const isSelected = prev.includes(vibe);
      if (!isSelected && prev.length >= MAX_STYLE_VIBES) return prev;
      return isSelected ? prev.filter((v) => v !== vibe) : [...prev, vibe];
    });
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
      // `animationType="fade"`, not the previous `"slide"` — react-native-
      // web's own ModalAnimation.js implements the slide-in transition with
      // a real CSS `transform` on this Modal's outer wrapper (`translateY`,
      // even the RESTING value after the animation finishes is still a
      // literal `transform: translateY(0%)`, not `transform: none`). ANY
      // non-`none` `transform` on an ancestor creates a new containing
      // block for `position: fixed` descendants — that's what was making
      // every "fixed" footer/button inside this Modal (the Continue button
      // included) anchor to THIS wrapper's box instead of the real browser
      // viewport, which is exactly the classic iOS Safari "position:fixed
      // swims/jumps when the on-screen keyboard opens" bug. `"fade"`'s own
      // animation (see ModalAnimation.js's `fadeIn`/`fadeOut`) only ever
      // touches `opacity`, never `transform`, so it doesn't create that
      // containing block at all — the Continue button now genuinely
      // anchors to the real viewport and stays put when the keyboard opens.
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* `presentationStyle="fullScreen"` presents this Modal as a genuinely
          separate native root on iOS — react-native-safe-area-context's
          insets are resolved from the nearest ancestor SafeAreaProvider IN
          THE REACT TREE, but that provider's own native measurement is tied
          to whatever window it's actually mounted in. The app's one root
          SafeAreaProvider (App.js) lives in the ORIGINAL window, not this
          Modal's new one, so without a SafeAreaProvider re-mounted here,
          `useSafeAreaInsets()` below would read stale/zeroed insets and this
          screen's headers would render flush under the status bar — the
          exact "titles clipped by the status bar" bug this fixes. This is
          `react-native-safe-area-context`'s own documented workaround for
          RN's `Modal`, not a project-specific hack. */}
      <SafeAreaProvider>
        <RegistrationFlowRoot
          footer={
            stepKey !== 'google' && (
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
            )
          }
        >
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
              <View style={[styles.stepBlock, styles.genderStepPad]}>
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
              <View style={[styles.stepBlock, styles.stepContentPad]}>
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
                        onFocus={scrollFieldIntoView}
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
                        onFocus={scrollFieldIntoView}
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
              <View style={[styles.stepBlock, styles.stepContentPad]}>
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
                  richCards
                />
              </View>
            )}

            {stepKey === 'bodyMeasurements' && (
              <View style={[styles.stepBlock, styles.stepContentPad]}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.bodyMeasurements')}</Text>

                {/* cm/in toggle — same segmented-pill styling as the
                    height/weight step's own metric/imperial UNIT_SYSTEMS
                    toggle above, reused as-is since both are the same
                    "pick a unit, don't convert" control. */}
                <View style={styles.unitToggleWrap}>
                  {MEASUREMENT_UNITS.map((unit) => {
                    const isSelected = measurementUnitValue === unit;
                    return (
                      <TouchableOpacity
                        key={unit}
                        style={[styles.unitToggleOption, isSelected && styles.unitToggleOptionSelected]}
                        onPress={() => setMeasurementUnitValue(unit)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.unitToggleText, isSelected && styles.unitToggleTextSelected]}>
                          {t(unit === 'cm' ? 'common.units.cm' : 'common.units.in')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.bodyMeasurementsList}>
                  <BodyMeasurementRow
                    label={t('profile.fields.shoulders')}
                    value={shouldersInput}
                    onChangeText={(text) => setShouldersInput(filterDigits(text))}
                  />
                  <BodyMeasurementRow
                    label={t('profile.fields.chest')}
                    value={chestInput}
                    onChangeText={(text) => setChestInput(filterDigits(text))}
                  />
                  <BodyMeasurementRow
                    label={t('profile.fields.waist')}
                    value={waistInput}
                    onChangeText={(text) => setWaistInput(filterDigits(text))}
                  />
                  <BodyMeasurementRow
                    label={t('profile.fields.hips')}
                    value={hipsInput}
                    onChangeText={(text) => setHipsInput(filterDigits(text))}
                    last
                  />
                </View>
              </View>
            )}

            {stepKey === 'styleVibes' && (
              <View style={[styles.stepBlock, styles.stepContentPad]}>
                <Text style={styles.stepTitle}>{t('profile.sections.styleVibes')}</Text>
                <Text style={styles.stepSubtitle}>{t('profile.styleVibes.helper')}</Text>
                <View style={styles.styleVibeWrap}>
                  {STYLE_VIBES.map((vibe) => {
                    const isSelected = styleVibesValue.includes(vibe);
                    const atCap = !isSelected && styleVibesValue.length >= MAX_STYLE_VIBES;
                    return (
                      <TouchableOpacity
                        key={vibe}
                        style={[
                          styles.styleVibeChip,
                          isSelected && styles.styleVibeChipSelected,
                          atCap && styles.styleVibeChipDisabled,
                        ]}
                        onPress={() => toggleStyleVibe(vibe)}
                        disabled={atCap}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[styles.styleVibeChipText, isSelected && styles.styleVibeChipTextSelected]}
                        >
                          {t(`profile.styleVibes.${vibe}`)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {stepKey === 'stylePreferences' && (
              <View style={[styles.stepBlock, styles.stepContentPad]}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.stylePreferences')}</Text>
                <TextInput
                  style={styles.styleNotesInput}
                  value={stylePreferencesValue}
                  onChangeText={setStylePreferencesValue}
                  onFocus={scrollFieldIntoView}
                  placeholder={t('onboarding.stylePreferencesStep.placeholder')}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  textAlignVertical="top"
                />
              </View>
            )}

            {stepKey === 'hairColor' && (
              <View style={[styles.stepBlock, styles.stepContentPad]}>
                <Text style={styles.stepTitle}>{t('onboarding.steps.hairColor')}</Text>
                <ColorSwatchPicker
                  options={getHairColorOptions(genderValue)}
                  value={hairColorValue}
                  onChange={setHairColorValue}
                  swatchStyle="hair"
                  center
                  columns={3}
                  showIllustration={false}
                />
              </View>
            )}

            {stepKey === 'eyeColor' && (
              <View style={[styles.stepBlock, styles.stepContentPad]}>
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
              <View style={[styles.stepBlock, styles.stepContentPad]}>
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
                      <MaterialCommunityIcons name="telegram" size={20} color={colors.inverseText} />
                      <Text style={styles.googleBtnText}>{t('closet.scan.authPrompt.googleButton')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        </ScrollView>
        </RegistrationFlowRoot>
      </SafeAreaProvider>
    </Modal>
  );
}

// One row of the Body Measurements step — label left, numeral right, same
// hairline-row idiom EditProfileScreen's own NumberRow uses, swapped in for
// the previous 2x2 grid (shoulders/chest side by side, waist/hips side by
// side) per the client's own request: a single stacked column instead. No
// per-row unit suffix either — the cm/in choice is made ONCE via the
// segmented toggle above this list, not repeated next to every number.
function BodyMeasurementRow({ label, value, onChangeText, last }) {
  return (
    <View style={[styles.bodyMeasurementRow, last && styles.bodyMeasurementRowLast]}>
      <Text style={styles.bodyMeasurementRowLabel}>{label}</Text>
      <TextInput
        style={styles.bodyMeasurementRowInput}
        value={value}
        onChangeText={onChangeText}
        onFocus={scrollFieldIntoView}
        keyboardType="numeric"
        maxLength={3}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

// Reads real safe-area insets from the nested `SafeAreaProvider` above (see
// that provider's own comment for why this can't just be a hook call at the
// top of RegistrationFlow itself — a hook reads context from where ITS OWN
// component sits in the tree, and RegistrationFlow sits ABOVE the Modal's
// own nested provider, not inside it).
//
// `footer` (the Continue/Finish button) renders in its own `position:
// 'fixed'` layer, NOT as a normal flex-flow sibling of `children` the way
// it used to — a plain flow position left it vulnerable to the on-screen
// keyboard's viewport resize pushing it up along with everything else
// (reported directly: "the button shouldn't rise with the keyboard, pin it
// in place"). `position: 'fixed'` genuinely anchors to the real browser
// viewport now that the Modal's own `animationType` is `"fade"` (see that
// prop's own comment — `"slide"` used to leave a `transform` on an
// ancestor, which creates a new containing block that `fixed` would anchor
// to INSTEAD of the true viewport). `children` gets its own scrollable
// area above it, sized to `flex: 1` so it fills whatever's left.
function RegistrationFlowRoot({ children, footer }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.rootScrollArea, { paddingTop: insets.top }]}>{children}</View>
      {footer ? (
        <View style={[styles.fixedFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-screen root — replaces BottomSheet's own rounded-top sheet
  // surface. `colors.background` (not `colors.surface`) so this reads as a
  // distinct, dedicated screen rather than a raised card floating over the
  // app, matching the mockup's own full-screen registration flow.
  root: { flex: 1, backgroundColor: colors.background },
  rootScrollArea: { flex: 1 },
  // Pinned to the real viewport bottom (see RegistrationFlowRoot's own
  // comment) — `backgroundColor` matches `root` so it reads as one
  // continuous surface with whatever's scrolled underneath it, not a
  // floating card. `alignItems: 'center'` centers `continueBtn`'s own 90%
  // width; `paddingBottom` (safe-area aware) is set inline by the caller.
  fixedFooter: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingTop: spacing.sm,
  },
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
  // `paddingBottom: 120` — clears the now-`position: 'fixed'` footer
  // (button + its own top padding + safe-area bottom padding), which no
  // longer takes up flex space of its own the way an in-flow sibling
  // would, so the last row of a tall step (Body Measurements' four fields)
  // doesn't end up sitting underneath it.
  scrollWrap: { paddingHorizontal: spacing.md, paddingBottom: 120, flexGrow: 1 },
  // `flex: 1` (on top of the old `minHeight` floor, kept as a safety net
  // for a step shorter than the screen) is what lets the final step's
  // `googleStepBlock` truly center within the full available height instead
  // of just its own 280px minimum — see `scrollFlex`'s own comment above.
  // Every other step still renders top-down as before: none of them set a
  // `justifyContent` of their own, so filling extra vertical space here
  // doesn't shift their content, it just gives the LAST step something
  // real to center inside.
  stepBlock: { flex: 1, minHeight: 320 },
  // The system-level fix for "title reads as pinned under the progress
  // bar" (a point-fix on `stepTitle`'s own `marginTop` turned out not to be
  // reliably visible enough on every device/font-scale) — applied to the
  // OUTER wrapper of every quiz-QUESTION step (gender, measurements,
  // bodyType, hairColor, eyeColor, skinTone: `style={[styles.stepBlock,
  // styles.stepContentPad]}` in the render below), never to `stepBlock`
  // itself, so the Google step — which also uses `stepBlock` as its own
  // base style — never inherits this. Deliberately NOT `insets.top +
  // spacing.xl + ...`: the root View already applies `insets.top` as its
  // own `paddingTop` (see the render below) and the header row sits ABOVE
  // this ScrollView as a normal flex sibling, not an overlay — the safe
  // area is already spent by the time this container starts, so adding it
  // again would double-count it and push content needlessly far down on
  // notched devices. `xxxl + xl` (56 + 40 = 96) is just "a clearly
  // generous, token-built gap," picked to comfortably clear the header's
  // own height (back/close icons + progress bar) with real margin to
  // spare, not a measurement of that height.
  stepContentPad: { paddingTop: spacing.xxxl + spacing.xl },
  // Gender step only — same base clearance as stepContentPad, plus extra
  // room so this specific step's whole block (title + chips + Continue,
  // since `stepBlock`'s own flex:1 carries that push down through the rest
  // of the column) sits lower, with more breathing room above it than every
  // other question step gets.
  genderStepPad: { paddingTop: spacing.xxxl + spacing.xl + spacing.xxl },
  // Large, bold, black, and centered on every step (gender, measurements,
  // body shape, hair/eye color, skin tone — every question this flow asks)
  // — a small, grey, ALL-CAPS `typography.label` (BodyShapeSelector's and
  // ColorSwatchPicker's own default `sectionLabel`, meant for
  // EditProfileScreen's compact stacked form) read as an afterthought next
  // to the big centered answer grids below it, and directly caused the
  // "WHAT IS YOUR HAIR COLOR?" look — that's `textTransform: 'uppercase'`
  // acting on an already-sentence-case translation string, not the string
  // itself shouting. Top spacing is `stepContentPad`'s job now (see that
  // style's own comment) — this keeps only a small breathing gap of its
  // own, so it still reads right on the rare step short enough that
  // `stepContentPad`'s padding is the only thing above it.
  stepTitle: {
    ...typography.h2,
    fontSize: 30,
    // typography.h2's own lineHeight (24) is tuned for ITS fontSize (20),
    // not this one — spreading h2 above and only overriding fontSize left
    // lineHeight stale at 24, shorter than the 30px glyphs it now has to
    // hold. That's what clipped the top of every step title: the line box
    // was literally smaller than the text inside it. ~1.27x fontSize here,
    // matching h2's own ~1.2x ratio (24/20) instead of drifting further off
    // it as fontSize keeps changing.
    lineHeight: 38,
    fontWeight: 'bold',
    textAlign: 'center',
    color: colors.textPrimary,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  stepSubtitle: { ...typography.bodySecondary, fontSize: 14, textAlign: 'center', marginBottom: spacing.md },

  // Gender step's answer grid. `justifyContent: 'center'` + `gap` (not the
  // old `space-between` + `rowGap`) is what actually keeps this symmetric
  // regardless of how many options there are — `space-between` only reads
  // as centered when a row happens to fill completely, which broke back
  // when GENDERS still had a third ('Other') option and its lone last-row
  // chip got shoved flush left with a big empty gap beside it instead of
  // sitting centered.
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
  genderChipText: { fontSize: 19, fontWeight: '600', color: colors.textPrimary },
  genderChipTextSelected: { color: colors.inverseText },

  // Style Preferences step — same STYLE_VIBES chip idiom EditProfileScreen's
  // own StyleVibeSection uses (pill, ink fill when selected, dimmed when
  // capped), sized for this flow's bigger full-screen question layout
  // rather than that screen's compact accordion.
  styleVibeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  styleVibeChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  styleVibeChipSelected: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  // Same cap-reached treatment as EditProfileScreen's own `chipDisabled` —
  // dimmed but still legible, not hidden.
  styleVibeChipDisabled: { opacity: opacityTokens.disabled },
  styleVibeChipText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  styleVibeChipTextSelected: { color: colors.inverseText },

  // Style Preferences step's free-text box — same surface/border language
  // as every boxed input elsewhere in this flow (`colors.surface` fill,
  // `colors.borderStrong` outline, `radius.lg` corners), just tall enough
  // for ~4 lines and top-aligned (`textAlignVertical: 'top'`) so typed text
  // starts at the top-left like a real notes field instead of vertically
  // centering after the first line.
  styleNotesInput: {
    marginTop: spacing.md,
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },

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

  // Body Measurements step — single stacked column (label left, numeral
  // right, hairline row) instead of a 2x2 grid, same idiom
  // EditProfileScreen's own NumberRow uses. No per-row unit suffix — the
  // cm/in choice lives once in the segmented toggle above this list.
  bodyMeasurementsList: { marginTop: spacing.md },
  bodyMeasurementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  bodyMeasurementRowLast: { borderBottomWidth: 0 },
  bodyMeasurementRowLabel: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  bodyMeasurementRowInput: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
    minWidth: 60,
  },

  // Floating, not edge-to-edge — `width: '90%'` (overriding `buttons.
  // primary`'s own `width: '100%'`, which this style object is spread
  // AFTER in the style array) leaves clear side margins instead of the
  // pill running flush to both screen edges. No margin of its own — its
  // parent `fixedFooter` already supplies top spacing and safe-area-aware
  // bottom padding. Same style object on every non-Google step, so the
  // button reads identically regardless of which question is showing.
  continueBtn: { width: '90%' },

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
