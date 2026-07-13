import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Dimensions, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../services/supabaseClient';
import { useUserStore } from '../store/useUserStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { colors, spacing, radius, buttons, typography } from '../theme/tokens';
import {
  GENDERS,
  EYE_COLORS,
  SKIN_TONES,
  getHairColorOptions,
  getBodyTypeOptions,
  filterDigits,
} from '../constants/profileOptions';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import BodyShapeSelector from '../components/BodyShapeSelector';

WebBrowser.maybeCompleteAuthSession();

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const redirectUri = AuthSession.makeRedirectUri();

// Time the selected chip stays visibly highlighted before the step transitions.
const HIGHLIGHT_HOLD = 450;
// Duration of the slide/fade transition between steps.
const TRANSITION_DURATION = 350;
const SLIDE_DISTANCE = 48;

const HEIGHT_MIN_CM = 90;
const HEIGHT_MAX_CM = 250;
const WEIGHT_MIN_KG = 20;
const WEIGHT_MAX_KG = 300;

// Smart defaults — every selector step starts pre-filled with a plausible
// answer instead of a blank grid, so no screen the client lands on ever
// reads as empty (they can still change any of these before moving on).
const DEFAULT_GENDER = GENDERS[0];
const DEFAULT_EYE_COLOR = EYE_COLORS[0].label;
const DEFAULT_SKIN_TONE = SKIN_TONES[3].label;

function defaultHairColorFor(gender) {
  return getHairColorOptions(gender)[0].label;
}

function defaultBodyTypeFor(gender) {
  return getBodyTypeOptions(gender)[0];
}

function buildDefaultAnswers() {
  return {
    gender: DEFAULT_GENDER,
    hairColor: defaultHairColorFor(DEFAULT_GENDER),
    eyeColor: DEFAULT_EYE_COLOR,
    skinTone: DEFAULT_SKIN_TONE,
    bodyType: defaultBodyTypeFor(DEFAULT_GENDER),
  };
}

// Whether a given step already holds a real answer — a smart default counts
// (it's a genuine, editable value the client would actually see, not a
// placeholder), but the free-text/optional steps only count once the client
// has actually passed through them, and the final auth step never counts
// until the account genuinely exists. This is what lets the progress bar
// below reflect real state instead of a fixed head-start.
function stepHasValue(s, answers, currentLanguage) {
  switch (s.key) {
    case 'language':
      return Boolean(currentLanguage);
    case 'gender':
    case 'hairColor':
    case 'eyeColor':
    case 'skinTone':
    case 'bodyType':
      return Boolean(answers[s.key]);
    case 'measurements':
      return answers.height != null && answers.weight != null;
    case 'bodyMeasurements':
      return Boolean(answers.measurements);
    case 'stylePreferences':
      return answers.stylePreferences != null;
    default:
      return false;
  }
}

// Step 1 (language) always leads; steps 2-9 are the existing fit-profile
// questions, shifted one slot later. `t` is threaded in here (rather than
// called per-field below) so the array itself re-builds — and every label
// in it updates — the instant the client picks a language on step 1.
// `includeAuthStep` appends the account-creation step at the very end —
// only once profile setup is fully done (IKEA effect: the client has
// already invested the effort before being asked to create an account).
// Skipped entirely for a client who already has a session (e.g. re-running
// Onboarding after a profile reset) since completeOnboarding can write
// straight to their existing user row without a fresh sign-in.
function buildSteps(t, gender, includeAuthStep) {
  const steps = [
    { key: 'language', type: 'language', question: t('onboarding.languageStep.title') },
    { key: 'gender', type: 'chips', question: t('onboarding.steps.gender'), options: GENDERS },
    {
      key: 'hairColor',
      type: 'colorSwatch',
      question: t('onboarding.steps.hairColor'),
      options: getHairColorOptions(gender),
      swatchStyle: 'hair',
    },
    {
      key: 'eyeColor',
      type: 'colorSwatch',
      question: t('onboarding.steps.eyeColor'),
      options: EYE_COLORS,
      swatchStyle: 'eye',
    },
    {
      key: 'skinTone',
      type: 'colorSwatch',
      question: t('onboarding.steps.skinTone'),
      options: SKIN_TONES,
      swatchStyle: 'flat',
    },
    { key: 'measurements', type: 'measurements', question: t('onboarding.steps.measurements') },
    {
      key: 'bodyType',
      type: 'bodyShape',
      question: t('onboarding.steps.bodyType'),
      options: getBodyTypeOptions(gender),
    },
    {
      key: 'bodyMeasurements',
      type: 'bodyMeasurements',
      question: t('onboarding.steps.bodyMeasurements'),
    },
    {
      key: 'stylePreferences',
      type: 'stylePreferences',
      question: t('onboarding.steps.stylePreferences'),
    },
  ];

  if (includeAuthStep) {
    steps.push({ key: 'auth', type: 'auth', question: t('onboarding.steps.auth') });
  }

  return steps;
}

export default function OnboardingScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const completeOnboarding = useUserStore((state) => state.completeOnboarding);
  const isLoggedIn = useUserStore((state) => state.isLoggedIn);
  const existingGender = useUserStore((state) => state.gender);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedValue, setSelectedValue] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [shouldersInput, setShouldersInput] = useState('');
  const [chestInput, setChestInput] = useState('');
  const [waistInput, setWaistInput] = useState('');
  const [hipsInput, setHipsInput] = useState('');
  const [stylePreferencesInput, setStylePreferencesInput] = useState('');
  // Mirrors answersRef.current.bodyType reactively — the ref alone can't
  // drive the Continue button's disabled state or BodyShapeSelector's
  // controlled `value` prop, since writing to a ref doesn't trigger a
  // re-render the way this step's confirm-via-button flow needs.
  const [bodyTypeValue, setBodyTypeValue] = useState(null);
  // Pre-seeded with smart defaults (see buildDefaultAnswers above) instead
  // of starting empty — every selector step already has a real, genuine
  // answer in here before the client ever taps anything, which is what lets
  // the progress bar below count them as actual completed progress rather
  // than a hardcoded head start.
  const answersRef = useRef(buildDefaultAnswers());

  // Snapshotted ONCE, at mount — NOT recomputed from `isLoggedIn` on every
  // render. `isLoggedIn` flips true mid-flow the instant the auth step's own
  // Google sign-in succeeds, while `stepIndex` is still pointing at that
  // step (the last one). Recomputing this live from `!isLoggedIn` made
  // `buildSteps` drop the 'auth' entry the moment sign-in succeeded,
  // shrinking `steps` out from under a still-valid `stepIndex` — `step`
  // became `undefined`, and the very next `step.key`/`step.type` read threw
  // a TypeError with no error boundary anywhere in the app: the white
  // screen after Google sign-in. Freezing this at mount keeps `steps` (and
  // therefore its length) constant for the component's whole lifetime.
  const [includeAuthStep] = useState(!isLoggedIn);

  // Google sign-in — moved here (from the old standalone AuthScreen) so
  // account creation is the very last thing asked for, after the client has
  // already invested the effort of answering every profile question.
  // AuthScreen.js/App.js's old isLoggedIn-first gate is gone; only a client
  // who already has a session (e.g. re-running Onboarding after
  // resetProfileParams) skips this step entirely, via includeAuthStep below.
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [nonce, setNonce] = useState(null);
  const completingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function generateNonce() {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      if (!cancelled) setNonce({ raw: rawNonce, hashed: hashedNonce });
    }
    generateNonce();
    return () => {
      cancelled = true;
    };
  }, []);

  const discovery = AuthSession.useAutoDiscovery('https://accounts.google.com');
  const [authRequest, authResponse, promptGoogleSignIn] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.IdToken,
      usePKCE: false,
      extraParams: nonce ? { nonce: nonce.hashed } : undefined,
    },
    discovery
  );

  useEffect(() => {
    if (authResponse?.type === 'success') {
      signInWithGoogleIdToken(authResponse.params.id_token);
    } else if (authResponse?.type === 'error') {
      setAuthError(authResponse.error?.message || t('onboarding.authStep.genericError'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authResponse]);

  async function signInWithGoogleIdToken(idToken) {
    setAuthError(null);
    setSigningIn(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
        nonce: nonce.raw,
      });
      if (signInError) throw signInError;
      // No local login() call here — useSupabaseAuthSync's onAuthStateChange
      // listener picks up the new session, fetches the (still-blank) profile
      // row, and flips isLoggedIn — the effect below watches for that and
      // fires completeOnboarding with everything collected in this flow.
    } catch (err) {
      setAuthError(err.message || t('onboarding.authStep.genericError'));
    } finally {
      setSigningIn(false);
    }
  }

  function handleGooglePress() {
    if (!authRequest || !nonce || signingIn) return;
    promptGoogleSignIn();
  }

  const contentOpacity = useSharedValue(1);
  const contentTranslateX = useSharedValue(0);

  const steps = buildSteps(t, answersRef.current.gender, includeAuthStep);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  // Fires once the auth step's Google sign-in actually lands a session —
  // this is what turns the answers collected above into a real profile,
  // instead of the auth step's own Continue button (there isn't one; the
  // sign-in itself is the terminal action). Guarded by completingRef so a
  // later, unrelated isLoggedIn flip (there shouldn't be one while this
  // screen is mounted) can't call completeOnboarding a second time.
  //
  // Also guarded by `!existingGender`: a RETURNING client who used the
  // "Already have an account? Sign in" escape hatch above never answered
  // these questions this session — answersRef still holds nothing but smart
  // defaults, and fetchProfile (run by useSupabaseAuthSync just before
  // isLoggedIn flips) has already loaded their real saved profile into the
  // store. Calling completeOnboarding here would clobber that real profile
  // with placeholder defaults, so skip it entirely; App.js's `!gender` gate
  // already routes them straight into the app once isLoggedIn is true.
  //
  // `step?.key` (not `step.key`) is defense-in-depth: `includeAuthStep`
  // above already keeps `steps`/`step` from ever going out of sync with
  // `stepIndex`, but this is exactly the read that crashed the whole screen
  // (white screen, no error boundary) back when it wasn't frozen, so it
  // stays optional-chained rather than trusting that invariant blindly.
  useEffect(() => {
    if (isLoggedIn && step?.key === 'auth' && !completingRef.current && !existingGender) {
      completingRef.current = true;

      // completeOnboarding does a real Supabase write (creating this
      // client's row for the very first time) — if that fails (offline,
      // RLS rejection, transient network error), the client is already
      // logged in with no gender set, so silently swallowing the failure
      // would leave them stuck re-rendering this same step with no
      // feedback. Surface it via Alert and let them retry the Google
      // button instead of the failure propagating into a white screen.
      (async () => {
        try {
          await completeOnboarding(answersRef.current);
        } catch (err) {
          completingRef.current = false;
          Alert.alert(
            t('onboarding.authStep.saveErrorTitle'),
            err?.message || t('onboarding.authStep.saveErrorMessage')
          );
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, step?.key, existingGender]);

  const answeredStepCount = steps.filter((s) => stepHasValue(s, answersRef.current, i18n.language)).length;
  const progressPercent = Math.round((answeredStepCount / steps.length) * 100);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateX: contentTranslateX.value }],
  }));

  // Repopulates whichever step's local input state (selectedValue,
  // heightInput, bodyTypeValue, …) from answersRef.current every time
  // stepIndex changes — including backward, via handleBack below. Forward
  // navigation into a step visited for the first time just finds nothing
  // in answersRef yet and resets to blank, same as before; the only new
  // behavior this adds is that navigating BACK to an already-answered step
  // now shows what was actually picked, instead of a blank/default step.
  useEffect(() => {
    const answers = answersRef.current;

    if (step.key === 'language') {
      setSelectedValue(i18n.language || null);
    } else if (step.type === 'chips' || step.type === 'colorSwatch') {
      setSelectedValue(answers[step.key] ?? null);
    } else if (step.key === 'measurements') {
      setHeightInput(answers.height != null ? String(answers.height) : '');
      setWeightInput(answers.weight != null ? String(answers.weight) : '');
    } else if (step.key === 'bodyType') {
      setBodyTypeValue(answers.bodyType ?? null);
    } else if (step.key === 'bodyMeasurements') {
      const m = answers.measurements || {};
      setShouldersInput(m.shoulders != null ? String(m.shoulders) : '');
      setChestInput(m.chest != null ? String(m.chest) : '');
      setWaistInput(m.waist != null ? String(m.waist) : '');
      setHipsInput(m.hips != null ? String(m.hips) : '');
    } else if (step.key === 'stylePreferences') {
      setStylePreferencesInput(answers.stylePreferences || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function transitionToNextStep() {
    const easingOut = Easing.in(Easing.cubic);

    // Slide + fade the current question out.
    contentOpacity.value = withTiming(0, { duration: TRANSITION_DURATION, easing: easingOut });
    contentTranslateX.value = withTiming(-SLIDE_DISTANCE, {
      duration: TRANSITION_DURATION,
      easing: easingOut,
    });

    setTimeout(() => {
      if (isLastStep) {
        completeOnboarding(answersRef.current);
        // App.js will swap to TabNavigator automatically once gender/etc. are set.
        return;
      }

      // Move to next step, snap the content in from the right (invisible), then fade/slide it in.
      setStepIndex((prev) => prev + 1);
      setSelectedValue(null);
      contentTranslateX.value = SLIDE_DISTANCE;
      contentOpacity.value = 0;

      const easingIn = Easing.out(Easing.cubic);
      contentOpacity.value = withTiming(1, { duration: TRANSITION_DURATION, easing: easingIn });
      contentTranslateX.value = withTiming(0, { duration: TRANSITION_DURATION, easing: easingIn });

      setIsTransitioning(false);
    }, TRANSITION_DURATION);
  }

  // Mirrors transitionToNextStep's choreography with the direction
  // reversed (slides out to the right / in from the left, instead of the
  // other way around) so "going back" reads as spatially distinct from
  // "going forward" — kept as its own function rather than a
  // direction-parameterized version of transitionToNextStep since that one
  // also owns the isLastStep -> completeOnboarding() branch, which has no
  // backward equivalent.
  function handleBack() {
    if (isTransitioning || stepIndex === 0) return;

    setIsTransitioning(true);
    const easingOut = Easing.in(Easing.cubic);

    contentOpacity.value = withTiming(0, { duration: TRANSITION_DURATION, easing: easingOut });
    contentTranslateX.value = withTiming(SLIDE_DISTANCE, {
      duration: TRANSITION_DURATION,
      easing: easingOut,
    });

    setTimeout(() => {
      setStepIndex((prev) => Math.max(0, prev - 1));
      contentTranslateX.value = -SLIDE_DISTANCE;
      contentOpacity.value = 0;

      const easingIn = Easing.out(Easing.cubic);
      contentOpacity.value = withTiming(1, { duration: TRANSITION_DURATION, easing: easingIn });
      contentTranslateX.value = withTiming(0, { duration: TRANSITION_DURATION, easing: easingIn });

      setIsTransitioning(false);
    }, TRANSITION_DURATION);
  }

  function handleSelectLanguage(code) {
    if (isTransitioning) return;

    setIsTransitioning(true);
    setSelectedValue(code);
    // i18next switches (and every t()-driven label on steps 2-9 re-renders)
    // synchronously here — the highlight hold below is purely cosmetic, not
    // something the language switch itself needs to wait on.
    setLanguage(code);

    setTimeout(transitionToNextStep, HIGHLIGHT_HOLD);
  }

  function handleSelect(option) {
    if (isTransitioning) return;

    setIsTransitioning(true);
    setSelectedValue(option);
    answersRef.current[step.key] = option;

    // Gender determines which hair-color/body-type list is even valid, and
    // both of those steps still hold their old gender's smart default —
    // re-derive them now so a client who changes gender here doesn't reach
    // an upcoming step pre-filled with an option from the wrong list.
    if (step.key === 'gender') {
      answersRef.current.hairColor = defaultHairColorFor(option);
      answersRef.current.bodyType = defaultBodyTypeFor(option);
    }

    // Let the user see the chip highlight before advancing.
    setTimeout(transitionToNextStep, HIGHLIGHT_HOLD);
  }

  function handleHeightChange(text) {
    setHeightInput(filterDigits(text));
  }

  function handleWeightChange(text) {
    setWeightInput(filterDigits(text));
  }

  const heightNum = Number(heightInput);
  const weightNum = Number(weightInput);
  const heightOutOfRange =
    heightInput.length > 0 && (heightNum < HEIGHT_MIN_CM || heightNum > HEIGHT_MAX_CM);
  const weightOutOfRange =
    weightInput.length > 0 && (weightNum < WEIGHT_MIN_KG || weightNum > WEIGHT_MAX_KG);
  const measurementsReady =
    heightInput.length > 0 && weightInput.length > 0 && !heightOutOfRange && !weightOutOfRange;

  function handleContinueMeasurements() {
    if (isTransitioning || !measurementsReady) return;

    setIsTransitioning(true);
    answersRef.current.height = heightNum;
    answersRef.current.weight = weightNum;

    transitionToNextStep();
  }

  // Unlike handleSelect (chips/color-swatch steps), this doesn't auto-
  // advance the instant a shape is tapped — BodyShapeSelector's own
  // expand/collapse-to-reconsider interaction needs the client to be able
  // to change their mind before committing, so this step only moves on
  // when they explicitly hit Continue (same pattern as the measurements
  // steps below, which also gate behind their own button rather than
  // auto-advancing on the first keystroke).
  function handleContinueBodyType() {
    if (isTransitioning || !bodyTypeValue) return;

    setIsTransitioning(true);
    answersRef.current.bodyType = bodyTypeValue;

    transitionToNextStep();
  }

  function handleContinueBodyMeasurements() {
    if (isTransitioning) return;

    setIsTransitioning(true);
    answersRef.current.measurements = {
      shoulders: shouldersInput ? Number(shouldersInput) : null,
      chest: chestInput ? Number(chestInput) : null,
      waist: waistInput ? Number(waistInput) : null,
      hips: hipsInput ? Number(hipsInput) : null,
    };

    transitionToNextStep();
  }

  function handleSkipBodyMeasurements() {
    if (isTransitioning) return;

    setIsTransitioning(true);
    answersRef.current.measurements = { shoulders: null, chest: null, waist: null, hips: null };

    transitionToNextStep();
  }

  function handleFinishStylePreferences() {
    if (isTransitioning) return;

    setIsTransitioning(true);
    answersRef.current.stylePreferences = stylePreferencesInput.trim();

    transitionToNextStep();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 96, paddingBottom: spacing.lg + insets.bottom }]}>
      {stepIndex > 0 && (
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + spacing.xs }]}
          onPress={handleBack}
          disabled={isTransitioning}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Feather name="chevron-left" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      )}

      <View style={[styles.progressTrack, { top: insets.top + spacing.xs + 40 }]}>
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>

      {/* Escape hatch for a RETURNING client — otherwise moving sign-in to
          the last step (see includeAuthStep above) would force anyone who
          already has an account (reinstall, logout/login) through the whole
          questionnaire again just to reach the Google button. Only shown
          pre-signup, on the first step. */}
      {!isLoggedIn && stepIndex === 0 && (
        <TouchableOpacity
          style={[styles.signInLink, { top: insets.top + spacing.xs }]}
          onPress={() => setStepIndex(steps.length - 1)}
          disabled={isTransitioning}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.signInLinkText}>{t('onboarding.authStep.alreadyHaveAccount')}</Text>
        </TouchableOpacity>
      )}

      <Animated.View style={[styles.content, contentStyle]}>
        <Text style={styles.question}>{step.question}</Text>

        {step.type === 'language' ? (
          <ScrollView
            style={styles.chipScroll}
            contentContainerStyle={styles.languageList}
            showsVerticalScrollIndicator={false}
          >
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isSelected = selectedValue === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[styles.languageCard, isSelected && styles.languageCardSelected]}
                  onPress={() => handleSelectLanguage(lang.code)}
                  disabled={isTransitioning}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.languageCardText, isSelected && styles.languageCardTextSelected]}>
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : step.type === 'measurements' ? (
          <View style={styles.measurementsWrap}>
            <MeasurementField
              value={heightInput}
              onChangeText={handleHeightChange}
              placeholder={t('onboarding.measurementsStep.heightPlaceholder')}
              unit="cm"
              error={heightOutOfRange ? t('onboarding.measurementsStep.heightError') : null}
            />
            <MeasurementField
              value={weightInput}
              onChangeText={handleWeightChange}
              placeholder={t('onboarding.measurementsStep.weightPlaceholder')}
              unit="kg"
              error={weightOutOfRange ? t('onboarding.measurementsStep.weightError') : null}
            />

            <TouchableOpacity
              style={[styles.continueBtn, !measurementsReady && styles.continueBtnDisabled]}
              onPress={handleContinueMeasurements}
              disabled={!measurementsReady || isTransitioning}
              activeOpacity={0.85}
            >
              <Text style={styles.continueBtnText}>{t('onboarding.buttons.continue')}</Text>
            </TouchableOpacity>
          </View>
        ) : step.type === 'bodyMeasurements' ? (
          <View style={styles.bodyMeasurementsWrap}>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkipBodyMeasurements}
              disabled={isTransitioning}
              activeOpacity={0.8}
            >
              <Text style={styles.skipBtnText}>{t('onboarding.buttons.skip')}</Text>
            </TouchableOpacity>

            <View style={styles.circGrid}>
              <CircumferenceInput
                label={t('profile.fields.shoulders')}
                value={shouldersInput}
                onChangeText={(text) => setShouldersInput(filterDigits(text))}
              />
              <CircumferenceInput
                label={t('profile.fields.chest')}
                value={chestInput}
                onChangeText={(text) => setChestInput(filterDigits(text))}
              />
              <CircumferenceInput
                label={t('profile.fields.waist')}
                value={waistInput}
                onChangeText={(text) => setWaistInput(filterDigits(text))}
              />
              <CircumferenceInput
                label={t('profile.fields.hips')}
                value={hipsInput}
                onChangeText={(text) => setHipsInput(filterDigits(text))}
              />
            </View>

            <TouchableOpacity
              style={styles.continueBtn}
              onPress={handleContinueBodyMeasurements}
              disabled={isTransitioning}
              activeOpacity={0.85}
            >
              <Text style={styles.continueBtnText}>{t('onboarding.buttons.continue')}</Text>
            </TouchableOpacity>
          </View>
        ) : step.type === 'stylePreferences' ? (
          <View style={styles.stylePrefsWrap}>
            <TextInput
              style={styles.stylePrefsInput}
              value={stylePreferencesInput}
              onChangeText={setStylePreferencesInput}
              placeholder={t('onboarding.stylePreferencesStep.placeholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={styles.continueBtn}
              onPress={handleFinishStylePreferences}
              disabled={isTransitioning}
              activeOpacity={0.85}
            >
              <Text style={styles.continueBtnText}>
                {isLastStep ? t('onboarding.buttons.finish') : t('onboarding.buttons.continue')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : step.type === 'auth' ? (
          <View style={styles.authWrap}>
            <Text style={styles.authSubtitle}>{t('onboarding.authStep.subtitle')}</Text>

            <TouchableOpacity
              style={[styles.continueBtn, (!authRequest || !nonce || signingIn) && styles.continueBtnDisabled]}
              onPress={handleGooglePress}
              disabled={!authRequest || !nonce || signingIn}
              activeOpacity={0.85}
            >
              {signingIn ? (
                <ActivityIndicator size="small" color={colors.inverseText} />
              ) : (
                <Text style={styles.continueBtnText}>{t('onboarding.authStep.googleButton')}</Text>
              )}
            </TouchableOpacity>

            {authError && <Text style={styles.authError}>{authError}</Text>}
          </View>
        ) : step.type === 'colorSwatch' ? (
          <ScrollView
            style={styles.chipScroll}
            contentContainerStyle={styles.colorSwatchScroll}
            showsVerticalScrollIndicator={false}
          >
            <ColorSwatchPicker
              options={step.options}
              value={selectedValue}
              onChange={handleSelect}
              swatchStyle={step.swatchStyle}
              size={64}
              center
              disabled={isTransitioning}
            />
          </ScrollView>
        ) : step.type === 'bodyShape' ? (
          <View style={styles.bodyShapeWrap}>
            <ScrollView
              style={styles.chipScroll}
              contentContainerStyle={styles.bodyShapeScroll}
              showsVerticalScrollIndicator={false}
            >
              <BodyShapeSelector
                options={step.options}
                value={bodyTypeValue}
                onChange={(shape) => {
                  setBodyTypeValue(shape);
                  answersRef.current.bodyType = shape;
                }}
                disabled={isTransitioning}
              />
            </ScrollView>

            <TouchableOpacity
              style={[styles.continueBtn, !bodyTypeValue && styles.continueBtnDisabled]}
              onPress={handleContinueBodyType}
              disabled={!bodyTypeValue || isTransitioning}
              activeOpacity={0.85}
            >
              <Text style={styles.continueBtnText}>{t('onboarding.buttons.continue')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.chipScroll}
            contentContainerStyle={styles.chipWrap}
            showsVerticalScrollIndicator={false}
          >
            {step.options.map((option) => {
              const isSelected = selectedValue === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => handleSelect(option)}
                  disabled={isTransitioning}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[styles.chipText, isSelected && styles.chipTextSelected]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {t(`onboarding.options.${option}`, option)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

function MeasurementField({ value, onChangeText, placeholder, unit, error }) {
  return (
    <View style={styles.measurementField}>
      <View style={styles.measurementInputRow}>
        <TextInput
          style={styles.measurementInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          maxLength={3}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
        />
        {value.length > 0 && <Text style={styles.measurementUnit}>{unit}</Text>}
      </View>
      {error && <Text style={styles.measurementError}>{error}</Text>}
    </View>
  );
}

function CircumferenceInput({ label, value, onChangeText }) {
  return (
    <View style={styles.circField}>
      <Text style={styles.circLabel}>{label}</Text>
      <View style={styles.circInputRow}>
        <TextInput
          style={styles.circInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          maxLength={3}
          placeholder="—"
          placeholderTextColor={colors.textMuted}
        />
        {value.length > 0 && <Text style={styles.circUnit}>cm</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    // paddingTop/paddingBottom set inline above, from real safe-area insets
    // (top must also clear the absolutely-positioned back button + progress
    // bar below; bottom clears the home indicator / gesture-nav bar).
  },
  // Pinned to the left explicitly (`left:` offset) rather than inheriting
  // the container's centered alignItems the way progressTrack below does —
  // this one needs to stay at the edge, not centered. `top` set inline
  // above, from real safe-area top inset.
  backBtn: {
    position: 'absolute',
    left: spacing.md,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  // Fill width is a real percentage (see progressPercent/stepHasValue above)
  // — it only ever shows what's actually been answered or genuinely
  // pre-filled with a default, never a fixed head start. `top` set inline
  // above, from real safe-area top inset.
  progressTrack: {
    position: 'absolute',
    width: 120,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
  },
  // `top` set inline above, from real safe-area top inset.
  signInLink: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 10,
  },
  signInLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: Math.min(SCREEN_WIDTH - 56, 420),
    alignItems: 'center',
  },
  question: {
    ...typography.h1,
    fontSize: 30,
    textAlign: 'center',
    lineHeight: 36,
    marginBottom: spacing.xl,
  },
  chipScroll: {
    flex: 1,
    width: '100%',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
    paddingBottom: spacing.md,
  },
  chip: {
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.inverseBackground,
    borderColor: colors.inverseBackground,
  },
  chipText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: colors.inverseText,
  },

  // Language step — vertical full-width cards (deliberately distinct from
  // the 2-up chip grid above; this is a short, ordered list, not a set of
  // interchangeable options).
  languageList: {
    width: '100%',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  languageCard: {
    width: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  languageCardSelected: {
    backgroundColor: colors.inverseBackground,
    borderColor: colors.inverseBackground,
  },
  languageCardText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  languageCardTextSelected: { color: colors.inverseText },

  colorSwatchScroll: {
    width: '100%',
    paddingBottom: spacing.md,
  },

  // Body shape step — scrollable selector (it can grow tall once the
  // illustration reveals) with its own Continue button pinned below,
  // rather than auto-advancing like the plain chip/color-swatch steps.
  bodyShapeWrap: { flex: 1, width: '100%', alignItems: 'center' },
  bodyShapeScroll: { width: '100%', paddingBottom: spacing.md },

  // Measurements step
  measurementsWrap: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  measurementField: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  measurementInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  measurementInput: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: spacing.xs,
    minWidth: 160,
  },
  measurementUnit: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  measurementError: {
    fontSize: 12,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  continueBtn: { ...buttons.primary, marginTop: spacing.sm },
  continueBtnDisabled: { ...buttons.disabled },
  continueBtnText: { ...buttons.primaryText, fontSize: 15 },

  // Body measurements step
  bodyMeasurementsWrap: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  skipBtn: { ...buttons.secondary, marginBottom: spacing.lg },
  skipBtnText: { ...buttons.secondaryText, fontSize: 15 },
  circGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
    marginBottom: spacing.lg,
  },
  circField: {
    width: '48%',
  },
  circLabel: {
    ...typography.label,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  circInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  circInput: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: spacing.xs,
    minWidth: 60,
  },
  circUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },

  // Style preferences step
  stylePrefsWrap: { width: '100%', paddingTop: spacing.xs },
  stylePrefsInput: {
    width: '100%',
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: spacing.md,
  },

  // Auth step — the final step, account creation, moved here from the old
  // standalone AuthScreen.
  authWrap: { width: '100%', alignItems: 'center', paddingTop: spacing.xs },
  authSubtitle: {
    ...typography.bodySecondary,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  authError: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
  },
});
