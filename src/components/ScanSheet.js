import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import BottomSheet from './BottomSheet';
import CenteredModal from './CenteredModal';
import RegistrationFlow from './RegistrationFlow';
import Toast from './Toast';
import { ChipPicker } from './ChipPicker';
import { readImageAsBase64 } from '../utils/imageBase64';
import { compressImage } from '../utils/imageCompression';
import { scanClothingItem } from '../services/aiScanner';
import { calculateColorDnaMatch } from '../utils/colorDna';
import { useUserStore } from '../store/useUserStore';
import { useToast } from '../hooks/useToast';
import { CATEGORIES, COLOR_OPTIONS } from '../constants/wardrobeOptions';
import { agreeColorWithNoun } from '../utils/colorAgreement';
import {
  colors,
  spacing,
  radius,
  typography,
  buttons,
  shadows,
  opacity as opacityTokens,
  withAlpha,
} from '../theme/tokens';
import { triggerHaptic } from '../utils/haptics';

// Choreographed "AI thinking" progress — there's really only one Gemini
// call happening underneath, not a literal multi-stage pipeline, but this
// is an honest description of what scanning an item actually involves
// (fabric read, color extraction, Color DNA cross-check, categorizing),
// cycled on a timer alongside a progress bar that never claims 100% until
// the real result has actually landed.
const SCAN_STATUS_KEYS = ['analyzingFabric', 'extractingColors', 'checkingColorDna', 'categorizing'];
const SCAN_STATUS_STEP_MS = 900;
const SCAN_PROGRESS_STEPS = [22, 48, 74, 92];
const MIN_ANALYZING_MS = SCAN_STATUS_KEYS.length * SCAN_STATUS_STEP_MS;

// Full add-item flow in one sheet: choose a photo source, watch the AI
// analyze it, see the verdict laid over the photo, then save — replacing
// the old flow's hop to a full-screen "confirm" form. Editing a wrong
// AI guess is still possible (see the collapsed "Edit details" section
// below) but is no longer the first thing the client has to do.
//
// Deferred Registration: "Save to Closet" is also the FIRST place a guest
// (WelcomeScreen's splash asks nothing at all — see that file) is ever
// asked for anything. The interception is a CENTERED dialog (CenteredModal),
// not another bottom sheet stacking on top of this one, and the
// account-creation step itself is a full step-by-step flow
// (RegistrationFlow): gender/height/weight/body type/hair/eye/skin color
// collected FIRST, entirely as that component's own local state, with
// Telegram sign-in as the LAST step — so account creation reads as "one tap
// to save everything I just told you", not a wall up front.
// RegistrationFlow's `onSuccess` below is what turns its collected answers
// into a real `completeOnboarding` call, right before the scanned item
// actually saves into the new profile.
export default function ScanSheet({ visible, onClose, onSave, palette }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('choose'); // 'choose' | 'analyzing' | 'result'
  const [imageUri, setImageUri] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [statusIndex, setStatusIndex] = useState(0);
  const [editingDetails, setEditingDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const { toastMessage, toastKey, showToast } = useToast();

  const isLoggedIn = useUserStore((state) => state.isLoggedIn);
  const gender = useUserStore((state) => state.gender);
  const height = useUserStore((state) => state.height);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const skinTone = useUserStore((state) => state.skinTone);
  const completeOnboarding = useUserStore((state) => state.completeOnboarding);

  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  // `needsCalibration` — true whenever ANY of gender/body type/height/
  // weight/Color DNA is still missing, checked at the store level (not
  // just local sheet state) so a client who already filled some of this in
  // elsewhere (e.g. ColorDnaCalibrationSheet, opened from the Color DNA
  // tile before ever scanning anything) doesn't get re-asked for it here.
  // `gender` is in this list now too — WelcomeScreen's splash no longer
  // collects it (see that file's own comment), so a fresh guest always has
  // it missing at this point.
  const needsCalibration = !gender || height == null || !hairColor || !eyeColor || !skinTone;
  const [registrationVisible, setRegistrationVisible] = useState(false);

  const progressWidth = useRef(new Animated.Value(0)).current;
  const sparkleOpacity = useRef(new Animated.Value(0.4)).current;
  const statusTimerRef = useRef(null);

  // Fresh slate every time the sheet opens — not on close, so the closing
  // slide-down animation doesn't visibly flash back to 'choose' first.
  // `setSaving(false)` was missing here — a stuck `saving: true` from a
  // PREVIOUS open (e.g. a save attempt that never reached performSave's own
  // `finally`, or the sheet closing mid-save) permanently disabled both the
  // Save and Retake buttons (`disabled={saving}`) on every later open, with
  // no way to recover short of a full reload — indistinguishable from a
  // hang, since tapping Save would silently do nothing at all.
  useEffect(() => {
    if (visible) {
      setStep('choose');
      setImageUri(null);
      setScanResult(null);
      setScanError(null);
      setStatusIndex(0);
      setEditingDetails(false);
      setSaving(false);
      setSaveError(null);
      setAuthPromptVisible(false);
      setRegistrationVisible(false);
      progressWidth.setValue(0);
    }
  }, [visible]);

  useEffect(() => {
    if (step !== 'analyzing') return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(sparkleOpacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => () => clearInterval(statusTimerRef.current), []);

  async function runAnalysis(uri) {
    setImageUri(uri);
    setStep('analyzing');
    setScanError(null);
    setStatusIndex(0);
    progressWidth.setValue(0);

    const startedAt = Date.now();
    let phase = 0;
    statusTimerRef.current = setInterval(() => {
      phase = Math.min(phase + 1, SCAN_STATUS_KEYS.length - 1);
      setStatusIndex(phase);
      Animated.timing(progressWidth, {
        toValue: SCAN_PROGRESS_STEPS[phase],
        duration: SCAN_STATUS_STEP_MS * 0.8,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    }, SCAN_STATUS_STEP_MS);

    try {
      const base64Image = await readImageAsBase64(uri);
      const result = await scanClothingItem(base64Image);
      // Never resolve faster than a full choreographed cycle — a scan that
      // comes back in 400ms would otherwise skip straight past every status
      // phrase, which reads as glitchy rather than fast.
      const remaining = Math.max(MIN_ANALYZING_MS - (Date.now() - startedAt), 0);

      setTimeout(() => {
        clearInterval(statusTimerRef.current);
        if (result.error) {
          setScanError(result.message);
          setStep('choose');
          return;
        }
        Animated.timing(progressWidth, {
          toValue: 100,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
        setScanResult({
          category: result.category,
          subcategory: result.subcategory,
          color: result.color,
          style: result.style,
          description: result.description,
        });
        setTimeout(() => setStep('result'), 260);
      }, remaining);
    } catch (err) {
      clearInterval(statusTimerRef.current);
      setScanError(err.message || t('closet.scan.genericError'));
      setStep('choose');
    }
  }

  // Downscales/re-compresses the picked photo before it ever touches
  // analysis or upload — see imageCompression.js's own comment for why an
  // ImagePicker `quality` setting alone isn't enough. Falls back to the
  // original uri on failure rather than blocking the scan entirely; the
  // Supabase upload timeout further down is still there as a backstop.
  async function pickedImageUri(asset) {
    try {
      return await compressImage(asset.uri, asset.width);
    } catch (err) {
      console.error('[ScanSheet] Image compression failed, using original:', err);
      return asset.uri;
    }
  }

  async function handleTakePhoto() {
    triggerHaptic();
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setScanError(t('closet.scan.cameraPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    runAnalysis(await pickedImageUri(result.assets[0]));
  }

  async function handleChooseFromLibrary() {
    triggerHaptic();
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setScanError(t('closet.scan.permissionMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    runAnalysis(await pickedImageUri(result.assets[0]));
  }

  function handleRetake() {
    if (saving) return;
    triggerHaptic();
    clearInterval(statusTimerRef.current);
    setStep('choose');
    setImageUri(null);
    setScanResult(null);
    setScanError(null);
    setEditingDetails(false);
  }

  function updateResultField(field, value) {
    setScanResult((prev) => ({ ...prev, [field]: value }));
  }

  // The actual `clothes` write — only ever called once both an auth session
  // AND a calibrated profile (height/weight/bodyType) are confirmed to
  // exist, by handleSave below.
  async function performSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ imageUri, ...scanResult });
      onClose();
    } catch (err) {
      // useWardrobeStore's addItem throws this exact string when
      // supabase.auth.getUser() comes back empty — shouldn't be reachable
      // now that handleSave itself gates on isLoggedIn first, but this is
      // the last line of defense: if a session is ever missing anyway (a
      // token that expired mid-flow, or a future regression), the client
      // should see a plain "please log in" message, never the raw
      // Supabase/auth error string.
      const isAuthError = /not signed in/i.test(err.message || '');
      // Matches the message useWardrobeStore's own `withTimeout` throws —
      // a stalled upload/insert on a weak connection never rejects on its
      // own, so without that timeout this exact case is the one that
      // actually hangs (not a Supabase error at all, just a promise that
      // never settles) rather than being merely hard to notice.
      const isTimeoutError = /timed out/i.test(err.message || '');
      // Matches the exact string useWardrobeStore's own addItem throws for
      // its freemium-cap backstop (see that function's own comment) — same
      // "fixed English string in the store, localized message picked here"
      // pattern as isAuthError/isTimeoutError above, so a client who somehow
      // reaches this backstop (see that comment for how) gets the same
      // translated paywall copy WardrobeScreen's primary check shows,
      // instead of a raw untranslated English string.
      const isWardrobeLimitError = /wardrobe limit reached/i.test(err.message || '');
      const message = isAuthError
        ? t('closet.scan.notSignedInError')
        : isTimeoutError
        ? t('closet.scan.timeoutError')
        : isWardrobeLimitError
        ? t('paywall.wardrobeLimitMessage')
        : err.message || t('closet.scan.genericError');

      // Logged for us to diagnose (the raw Supabase/Postgrest error — code,
      // hint, details — carries more than `.message` alone), surfaced to
      // the client via BOTH an inline banner (stays readable after the
      // toast fades, useful if they want to re-read it while editing
      // details and retrying) and a Toast. The toast is the part that
      // actually matters here: the inline banner alone rendered at the
      // bottom of the sheet, easy to miss below the fold with no scroll
      // indicator — which is exactly what made a real, already-caught error
      // read as "the app just froze, nothing happened" instead of a
      // failure the client could act on. (Used to be a native Alert, which
      // is a silent no-op on react-native-web — this app ships a real web
      // target, so that left web clients with only the easy-to-miss banner.)
      console.error('[ScanSheet] Save failed:', err);
      setSaveError(message);
      showToast(message);
    } finally {
      setSaving(false);
    }
  }

  // "Save to Closet" — Deferred Registration's actual gate. Three states:
  //   1. Guest (no session)              -> authPromptVisible (centered modal)
  //   2. Signed in, never calibrated      -> registrationVisible (params only, no Google step)
  //   3. Signed in AND calibrated         -> straight to performSave
  // handleRegistrationSuccess below re-runs after RegistrationFlow finishes
  // (either via its Google step for a guest, or its own last param step's
  // Continue for an already-signed-in client), so a fresh sign-up falls
  // straight through into the save without the client tapping Save twice.
  //
  // The guest check is THE FIRST STATEMENT in this function, before any
  // other read or side effect — no loader, no store/DB call, nothing —
  // touches state before it. `saving` only ever flips true inside
  // performSave(), which this returns before a guest can ever reach, so
  // there's no ordering that could leave a guest looking at a stuck
  // spinner in THIS function's own logic. `setSaving(false)` in the guest
  // branch below is still explicit, not just implied by that ordering —
  // belt-and-suspenders for the exact class of bug that caused the earlier
  // freeze report (a `saving: true` left stuck from a previous open/attempt
  // permanently disabling the Save button, since it's `disabled={saving}}`
  // — see the reset-on-visible effect's own comment above for where that
  // actually got fixed). A guest tapping Save is now guaranteed un-stuck
  // regardless of whatever `saving` happened to be a moment before.
  function handleSave() {
    if (!isLoggedIn) {
      setSaving(false);
      setAuthPromptVisible(true);
      return;
    }

    if (saving || !scanResult) return;

    if (needsCalibration) {
      setRegistrationVisible(true);
      return;
    }

    performSave();
  }

  // Declining the account-required dialog — the item stays sitting at the
  // 'result' step, unsaved, exactly as if the client just hadn't tapped
  // Save yet. `saving` is never true at this point (handleSave returns
  // before performSave() ever runs for a guest), so there's no spinner
  // left stuck on-screen to clean up here; this only needs to close the
  // dialog.
  function handleAuthPromptCancel() {
    setAuthPromptVisible(false);
  }

  function handleRegisterPress() {
    setAuthPromptVisible(false);
    setRegistrationVisible(true);
  }

  // RegistrationFlow's own onSuccess — fires once it's actually done: for a
  // guest, that's right after its Google step signs them in; for an
  // already-signed-in-but-uncalibrated client, that's its last param step's
  // own Continue. Either way, `profileData` is everything RegistrationFlow
  // collected as local state (gender included — see that component's own
  // comment) — `completeOnboarding` both local-sets AND (a session now
  // definitely exists either way) persists it to `public.users` in one
  // call, the same function Onboarding's own last step used to call, just
  // fired here instead, later, once the rest of the Fit Profile is
  // actually known.
  async function handleRegistrationSuccess(profileData) {
    setRegistrationVisible(false);
    try {
      await completeOnboarding(profileData);
      await performSave();
    } catch (err) {
      console.error('[ScanSheet] completeOnboarding failed:', err);
      showToast(err.message || t('closet.scan.calibration.genericError'));
    }
  }

  // Gated on `!needsCalibration` too — `getPalette` (WardrobeScreen's own
  // `palette` prop) silently falls back to DEEP_PALETTE for a null skinTone
  // rather than returning "unknown," so before the client has actually set
  // hair/eye/skin color this used to compute and display a real-looking
  // percentage against a made-up default palette — a genuine "Color DNA"
  // match the app has no basis to claim yet. `matchPercent` now stays null
  // until the profile is actually filled in; the render below falls back to
  // a literal "XX%" placeholder in that case instead of hiding the pill.
  const matchPercent = scanResult && !needsCalibration ? calculateColorDnaMatch(scanResult.color, palette) : null;
  const progressBarStyle = {
    width: progressWidth.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
  };

  // BottomSheet AND CenteredModal AND RegistrationFlow's own BottomSheet
  // are each a plain RN `<Modal>` (see those components' own comments for
  // why — no @gorhom/bottom-sheet in this project). RN explicitly does not
  // support two simultaneously-`visible` native Modals: the SAME "nested
  // Modals swallow every touch" failure that AppTour.js's own history
  // comment documents (and is why that overlay deliberately does NOT use
  // <Modal> at all) applies here too, just with two ordinary sheets instead
  // of a coach-mark. `authPromptVisible`/`registrationVisible` becoming
  // true while this sheet's own `visible` prop was STILL true meant BOTH
  // native Modal windows were mounted at once — on affected platforms/
  // versions that reads as exactly the reported bug: tapping "Save to
  // Closet" as a guest looks like the app just froze, because the
  // CenteredModal that WAS being told to show never actually became
  // interactable (or visible) on top of the still-live sheet underneath.
  // Gating this sheet's own `visible` on the two dialogs above it being
  // closed guarantees at most one native Modal is ever mounted at a time —
  // the sheet disappears the instant a guest taps Save (no slide-down
  // transition plays; `animationType="none"` means there's nothing left to
  // animate once the native modal itself is gone), and reappears the same
  // way if the client cancels back out of either dialog.
  const sheetVisible = visible && !authPromptVisible && !registrationVisible;

  return (
    <>
      <BottomSheet visible={sheetVisible} onClose={onClose}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {step === 'result' ? t('closet.scan.resultTitle') : t('closet.scan.sheetTitle')}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="x" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {step === 'choose' && (
          <View style={styles.chooseWrap}>
            <TouchableOpacity style={styles.choiceRow} onPress={handleTakePhoto} activeOpacity={0.8}>
              <View style={styles.choiceIconWrap}>
                <Feather name="camera" size={20} color={colors.accent} />
              </View>
              <View style={styles.choiceTextWrap}>
                <Text style={styles.choiceTitle}>{t('closet.scan.takePhoto')}</Text>
                <Text style={styles.choiceCaption}>{t('closet.scan.takePhotoCaption')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.choiceRow} onPress={handleChooseFromLibrary} activeOpacity={0.8}>
              <View style={styles.choiceIconWrap}>
                <Feather name="image" size={20} color={colors.accent} />
              </View>
              <View style={styles.choiceTextWrap}>
                <Text style={styles.choiceTitle}>{t('closet.scan.chooseFromLibrary')}</Text>
                <Text style={styles.choiceCaption}>{t('closet.scan.chooseFromLibraryCaption')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {scanError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{scanError}</Text>
              </View>
            )}
          </View>
        )}

        {step === 'analyzing' && (
          <View style={styles.analyzingWrap}>
            <Image source={{ uri: imageUri }} style={styles.analyzingImage} />

            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, progressBarStyle]} />
            </View>

            <View style={styles.analyzingStatusRow}>
              <Animated.View style={{ opacity: sparkleOpacity }}>
                <Feather name="zap" size={14} color={colors.accent} />
              </Animated.View>
              <Text style={styles.analyzingStatusText}>
                {t(`closet.scan.status.${SCAN_STATUS_KEYS[statusIndex]}`)}
              </Text>
            </View>
          </View>
        )}

        {step === 'result' && scanResult && (
          <View style={styles.resultWrap}>
            <View style={styles.resultImageWrap}>
              <Image source={{ uri: imageUri }} style={styles.resultImage} />
              <LinearGradient
                colors={['transparent', withAlpha('#000000', 0.78)]}
                style={styles.resultScrim}
                pointerEvents="none"
              />
              <View style={styles.resultOverlayContent}>
                <Text style={styles.resultVerdict}>
                  {t('closet.scan.verdict', {
                    color: agreeColorWithNoun(
                      t(`closet.colors.${scanResult.color}`, scanResult.color),
                      scanResult.subcategory
                    ),
                    item: scanResult.subcategory,
                  })}
                </Text>
                {scanResult.color && (
                  <View style={styles.matchPill}>
                    <Feather name="droplet" size={11} color={colors.inverseText} />
                    <Text style={styles.matchPillText}>
                      {/* needsCalibration (profile not filled in yet) means
                          matchPercent is deliberately null — see its own
                          comment above — a literal "XX" placeholder rather
                          than a fabricated real-looking number. */}
                      {t('closet.scan.colorDnaMatch', { percent: matchPercent ?? 'XX' })}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              style={styles.editToggle}
              onPress={() => setEditingDetails((prev) => !prev)}
              activeOpacity={0.7}
            >
              <Text style={styles.editToggleText}>{t('closet.scan.editDetails')}</Text>
              <Feather name={editingDetails ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
            </TouchableOpacity>

            {editingDetails && (
              <View style={styles.editFieldsWrap}>
                <Text style={styles.editFieldLabel}>{t('closet.confirm.category')}</Text>
                <ChipPicker
                  options={CATEGORIES}
                  value={scanResult.category}
                  onSelect={(value) => updateResultField('category', value)}
                  getLabel={(option) => t(`closet.categories.${option}`)}
                />
                <Text style={[styles.editFieldLabel, styles.editFieldLabelSpaced]}>{t('closet.confirm.color')}</Text>
                <ChipPicker
                  options={COLOR_OPTIONS}
                  value={scanResult.color}
                  onSelect={(value) => updateResultField('color', value)}
                  getLabel={(option) => t(`closet.colors.${option}`)}
                />
              </View>
            )}

            {saveError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}

            <View style={styles.resultActions}>
              <TouchableOpacity
                style={[buttons.secondary, styles.actionBtn, saving && styles.actionBtnDisabled]}
                onPress={handleRetake}
                disabled={saving}
                activeOpacity={0.8}
              >
                <Text style={buttons.secondaryText}>{t('closet.scan.retake')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[buttons.primary, styles.actionBtn, saving && styles.actionBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.inverseText} />
                ) : (
                  <Text style={buttons.primaryText}>{t('closet.scan.saveToCloset')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Rendered as a child of the sheet panel itself (not a screen-level
            sibling) — BottomSheet is a real native <Modal>, which portals
            above everything else in its own layer, so a Toast rendered
            outside it would be invisible while this sheet is open. */}
        <Toast key={toastKey} message={toastMessage} />
      </BottomSheet>

      {/* Centered, not a sheet stacking on top of the one above — Critical
          Change: this is a decision point ("you must have an account to
          continue"), not another form, so it reads as its own interstitial
          rather than "one more layer of the same flow". Backdrop-dismissible
          via CenteredModal's own onClose; declining just leaves the scanned
          item sitting at the 'result' step, unsaved. */}
      <CenteredModal visible={authPromptVisible} onClose={handleAuthPromptCancel}>
        <View style={styles.authPromptWrap}>
          <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.authPromptIconWrap}>
            <Feather name="lock" size={26} color={colors.inverseText} />
          </LinearGradient>
          <Text style={styles.authPromptTitle}>{t('closet.scan.authPrompt.title')}</Text>
          <Text style={styles.authPromptMessage}>{t('closet.scan.authPrompt.message')}</Text>

          <TouchableOpacity style={styles.registerBtn} onPress={handleRegisterPress} activeOpacity={0.85}>
            <Text style={styles.registerBtnText}>{t('closet.scan.authPrompt.registerButton')}</Text>
          </TouchableOpacity>

          {/* Explicit escape hatch — backdrop-dismiss (CenteredModal's own
              onClose) already closed this silently before; a visible Cancel
              is what actually tells the client "no account, no problem,
              this only cancels the save" instead of relying on them
              discovering the backdrop tap on their own. */}
          <TouchableOpacity style={styles.authPromptCancelBtn} onPress={handleAuthPromptCancel} activeOpacity={0.7}>
            <Text style={styles.authPromptCancelBtnText}>{t('closet.scan.authPrompt.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </CenteredModal>

      {/* Opened either by "Sign Up" above (guest) or directly by handleSave
          (already signed in, just never calibrated) — see RegistrationFlow's
          own comment for the full step-by-step shape and why Google is its
          LAST step, not its first. */}
      <RegistrationFlow
        visible={registrationVisible}
        onClose={() => setRegistrationVisible(false)}
        initialGender={gender}
        isLoggedIn={isLoggedIn}
        onSuccess={handleRegistrationSuccess}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: { ...typography.h2, fontSize: 17 },

  chooseWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  choiceIconWrap: {
    width: 44,
    height: 44,
    // Same squircle proportion as the Hub's own BentoTile icon chips
    // (40x40 / radius 14) scaled up slightly for this row's larger icon.
    borderRadius: 15,
    backgroundColor: withAlpha(colors.violet, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTextWrap: { flex: 1 },
  choiceTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  choiceCaption: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginTop: 1 },

  analyzingWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, alignItems: 'center' },
  analyzingImage: {
    width: '100%',
    height: 260,
    borderRadius: radius.cardLg,
    backgroundColor: colors.background,
    marginBottom: spacing.md,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  analyzingStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  analyzingStatusText: { fontSize: 13.5, fontWeight: '600', color: colors.textSecondary },

  resultWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  resultImageWrap: {
    width: '100%',
    height: 280,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
  },
  resultImage: { width: '100%', height: '100%' },
  resultScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  resultOverlayContent: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.sm, gap: 6 },
  resultVerdict: { color: colors.inverseText, fontSize: 17, fontWeight: '800', lineHeight: 21 },
  matchPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: withAlpha('#FFFFFF', 0.22),
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  matchPillText: { color: colors.inverseText, fontSize: 12, fontWeight: '700' },

  editToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  editToggleText: { fontSize: 13.5, fontWeight: '600', color: colors.textSecondary },
  editFieldsWrap: { marginBottom: spacing.sm },
  editFieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  editFieldLabelSpaced: { marginTop: spacing.sm },

  errorBox: {
    padding: spacing.sm,
    backgroundColor: colors.dangerBackground,
    borderRadius: radius.card,
    marginTop: spacing.xs,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  resultActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: { flex: 1 },
  actionBtnDisabled: { opacity: opacityTokens.disabled },

  // Account-required dialog (CenteredModal)
  authPromptWrap: { alignItems: 'center' },
  authPromptIconWrap: {
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
  authPromptTitle: { ...typography.h2, fontSize: 19, textAlign: 'center', marginBottom: spacing.xs },
  authPromptMessage: {
    ...typography.bodySecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  registerBtn: {
    width: '100%',
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.accent,
  },
  registerBtnText: { ...buttons.primaryText, fontSize: 16 },
  authPromptCancelBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authPromptCancelBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.textSecondary },
});
