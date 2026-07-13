import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Animated,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { CopilotStep, walkthroughable } from 'react-native-copilot';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { scanClothingItem } from '../services/aiScanner';
import { analyzeShoppingItem } from '../services/aiShoppingCopilot';
import { readImageAsBase64 } from '../utils/imageBase64';
import { getPalette } from '../utils/colorDna';
import { calculateCohesionScore, calculateEcoScore, calculateWardrobeLifecycle } from '../utils/wardrobeUtils';
import { generateDailyChallenge } from '../utils/dailyChallengeEngine';
import { formatWeekdayShortWithDate } from '../utils/dateFormat';
import { getInitials } from '../utils/getInitials';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useChatStore } from '../store/useChatStore';
import { usePlannerStore, toDateKey, getStyleStreak } from '../store/usePlannerStore';
import { useFadeOnFocus } from '../hooks/useFadeOnFocus';
import { useWeather } from '../hooks/useWeather';
import { colors, cardTints, spacing, radius, hairline, shadows, opacity, buttons, typography } from '../theme/tokens';
import { CATEGORIES, COLOR_OPTIONS } from '../constants/wardrobeOptions';
import { ChipPicker } from '../components/ChipPicker';
import WardrobeCatalogScreen from './WardrobeCatalogScreen';
import { FadeInView } from '../components/AnimatedPressable';
import { triggerHaptic } from '../utils/haptics';

const CopilotTouchable = walkthroughable(TouchableOpacity);
const CopilotView = walkthroughable(View);

// Radius for icon chips. The Hub's own cards use `radius.card` (redesign
// v2) — this constant lives on for the pieces that didn't move (icon chips,
// the confirm-scan flow).
const BENTO_RADIUS = 20;

// Border tint per section color — a touch darker/saturated than the card
// fill itself (`cardTints`), matching the redesign's "1px solid, ~15-20%
// alpha of the saturated color" card-border rule.
const TINT_BORDERS = {
  violet: 'rgba(108,77,246,0.18)',
  coral: 'rgba(255,122,89,0.18)',
  sky: 'rgba(47,143,224,0.18)',
  sage: 'rgba(62,143,99,0.2)',
};

// "Style Inspiration" strip — mood-only placeholder cards (no saved-board
// backend exists), replacing the old standalone Inspiration tab's full
// Pinterest-style grid with a compact taste of the same idea.
const INSPIRATION_TAGS = [
  { id: 'minimalism', icon: 'square' },
  { id: 'streetwear', icon: 'shopping-bag' },
  { id: 'office', icon: 'briefcase' },
  { id: 'casual', icon: 'sun' },
  { id: 'eveningwear', icon: 'moon' },
];

export default function WardrobeScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const user = useUserStore((state) => state.user);
  const wardrobe = useWardrobeStore((state) => state.items);
  const wardrobeLoading = useWardrobeStore((state) => state.loading);
  const wardrobeError = useWardrobeStore((state) => state.error);
  const fetchWardrobe = useWardrobeStore((state) => state.fetchWardrobe);
  const addItem = useWardrobeStore((state) => state.addItem);
  const fetchOutfits = usePlannerStore((state) => state.fetchOutfits);
  const skinTone = useUserStore((state) => state.skinTone);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const styleVibes = useUserStore((state) => state.styleVibes);
  const fadeOpacity = useFadeOnFocus();

  // 'hub' is the landing view (title/description + the two actions below);
  // 'catalog' drills into the category-grouped item browser. Kept as local
  // state rather than a nav stack — this tab has no other navigation depth,
  // and the scan/confirm flow already uses the same plain-state-machine
  // pattern below. Weekly Planner used to be a third nested view here too —
  // it's now its own `Planner` tab (see TabNavigator.js/PlannerScreen.js).
  const [view, setView] = useState('hub');
  const [pendingItem, setPendingItem] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [copilotAnalyzing, setCopilotAnalyzing] = useState(false);
  const [colorDnaModalVisible, setColorDnaModalVisible] = useState(false);

  const palette = useMemo(() => getPalette(skinTone, hairColor, eyeColor), [skinTone, hairColor, eyeColor]);
  const cohesionScore = useMemo(() => calculateCohesionScore(wardrobe), [wardrobe]);
  const ecoScore = useMemo(() => calculateEcoScore(wardrobe), [wardrobe]);
  const lifecycle = useMemo(() => calculateWardrobeLifecycle(wardrobe), [wardrobe]);

  // Closet is a lazy tab (React Navigation only mounts it on first visit),
  // so this only fires once per session, right when the client actually
  // opens it — not at app boot for a tab they may never open. fetchOutfits
  // rides along because the Style Streak tile below needs scheduledOutfits
  // too, and Closet is often the first tab opened in a session (before the
  // Planner tab itself, which also fetches on its own mount).
  useEffect(() => {
    fetchWardrobe();
    fetchOutfits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleScan() {
    triggerHaptic();
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('closet.scan.permissionTitle'), t('closet.scan.permissionMessage'));
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (pickerResult.canceled) return;

    const uri = pickerResult.assets[0].uri;
    setError(null);
    setAnalyzing(true);

    try {
      const base64Image = await readImageAsBase64(uri);
      const scanResult = await scanClothingItem(base64Image);
      if (scanResult.error) {
        setError(scanResult.message);
        return;
      }
      setPendingItem({
        imageUri: uri,
        category: scanResult.category,
        subcategory: scanResult.subcategory,
        color: scanResult.color,
        // Not shown/editable on the confirm screen, but still saved on
        // Confirm — the AI stylist prompt uses these for better advice.
        style: scanResult.style,
        description: scanResult.description,
      });
    } catch (err) {
      setError(err.message || t('closet.scan.genericError'));
    } finally {
      setAnalyzing(false);
    }
  }

  // Snaps a candidate purchase in-store and asks the AI for a quick "Buy or
  // Pass" verdict against the client's capsule score + chosen style vibes.
  async function handleShoppingCopilot() {
    if (copilotAnalyzing) return;

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('closet.scan.permissionTitle'), t('closet.hub.shoppingCopilot.cameraPermissionMessage'));
      return;
    }

    const cameraResult = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (cameraResult.canceled) return;

    setCopilotAnalyzing(true);
    try {
      const base64Image = await readImageAsBase64(cameraResult.assets[0].uri);
      const { verdict, reasoning } = await analyzeShoppingItem(base64Image, {
        capsuleScore: cohesionScore,
        styleVibes,
      });
      Alert.alert(verdict, reasoning);
    } catch (err) {
      Alert.alert(t('closet.scan.genericError'), err.message);
    } finally {
      setCopilotAnalyzing(false);
    }
  }

  async function handleConfirm() {
    if (isUploading) return;

    setError(null);
    setIsUploading(true);
    try {
      // addItem uploads the photo to Storage then inserts the `clothes`
      // row — a real network round-trip now, unlike the old synchronous
      // local-only addWardrobeItem, so this can genuinely fail (offline,
      // upload rejected, etc.) and needs to surface that instead of
      // silently discarding the client's scan.
      await addItem(pendingItem);
      setPendingItem(null);
      setEditingField(null);
    } catch (err) {
      setError(err.message || t('closet.scan.genericError'));
    } finally {
      setIsUploading(false);
    }
  }

  function handleDiscard() {
    if (isUploading) return;
    setPendingItem(null);
    setEditingField(null);
  }

  function updatePendingField(field, value) {
    setPendingItem((prev) => ({ ...prev, [field]: value }));
    setEditingField(null);
  }

  // ---- Confirmation step (after a scan) ----
  if (pendingItem) {
    return (
      <Animated.View style={[styles.container, { opacity: fadeOpacity }]}>
        <ScrollView contentContainerStyle={styles.confirmScroll}>
          <Image source={{ uri: pendingItem.imageUri }} style={styles.confirmImage} />

          <View style={styles.confirmBody}>
            <Text style={styles.confirmTitle}>{t('closet.confirm.title')}</Text>

            <EditableRow
              label={t('closet.confirm.category')}
              value={t(`closet.categories.${pendingItem.category}`)}
              expanded={editingField === 'category'}
              onPress={() => setEditingField(editingField === 'category' ? null : 'category')}
            >
              <ChipPicker
                options={CATEGORIES}
                value={pendingItem.category}
                onSelect={(value) => updatePendingField('category', value)}
                getLabel={(option) => t(`closet.categories.${option}`)}
              />
            </EditableRow>

            <EditableRow
              label={t('closet.confirm.color')}
              value={t(`closet.colors.${pendingItem.color}`)}
              expanded={editingField === 'color'}
              onPress={() => setEditingField(editingField === 'color' ? null : 'color')}
            >
              <ChipPicker
                options={COLOR_OPTIONS}
                value={pendingItem.color}
                onSelect={(value) => updatePendingField('color', value)}
                getLabel={(option) => t(`closet.colors.${option}`)}
              />
            </EditableRow>
          </View>
        </ScrollView>

        {error && (
          <View style={styles.confirmErrorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.confirmActions}>
          <TouchableOpacity
            style={[styles.discardBtn, isUploading && styles.confirmActionDisabled]}
            onPress={handleDiscard}
            disabled={isUploading}
            activeOpacity={0.8}
          >
            <Text style={styles.discardBtnText}>{t('closet.confirm.discard')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmBtn, isUploading && styles.confirmActionDisabled]}
            onPress={handleConfirm}
            disabled={isUploading}
            activeOpacity={0.85}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color={colors.inverseText} />
            ) : (
              <Text style={styles.confirmBtnText}>{t('closet.confirm.confirm')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // ---- Category browser ----
  if (view === 'catalog') {
    return (
      <WardrobeCatalogScreen wardrobe={wardrobe} loading={wardrobeLoading} onBack={() => setView('hub')} />
    );
  }

  // ---- Wardrobe Hub (default landing view) ----
  return (
    <Animated.View style={[styles.container, styles.hubContainer, { opacity: fadeOpacity }]}>
      <ScrollView contentContainerStyle={[styles.hubScroll, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <LinearGradient
            colors={[colors.violet, '#9B87FF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
          </LinearGradient>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerGreeting} numberOfLines={1}>
              {t('closet.hub.greeting', { name: user?.name?.split(' ')[0] || t('closet.hub.greetingFallback') })}
            </Text>
            <Text style={styles.headerDate} numberOfLines={1}>
              {formatWeekdayShortWithDate(new Date(), i18n.language)}
            </Text>
          </View>
        </View>

        <View style={styles.bentoGrid}>
          <FadeInView delay={0}>
            <WeatherWidget />
          </FadeInView>

          <Text style={styles.sectionLabel}>{t('closet.hub.todayLabel')}</Text>
          <FadeInView delay={60}>
            <DailyChallengeTile />
          </FadeInView>

          <View style={styles.bentoRow}>
            <FadeInView delay={100} style={styles.bentoRowItem}>
              <StyleStreakTile />
            </FadeInView>

            <FadeInView delay={140} style={styles.bentoRowItem}>
              <BentoTile
                square
                tint="sky"
                icon={<Feather name="star" size={18} color={colors.textPrimary} />}
                title={`${cohesionScore}%`}
                subtitle={t('closet.hub.capsuleScore.subtitle')}
                badge={
                  <>
                    <Feather name="lock" size={10} color={colors.inverseText} />
                    <Text style={styles.proBadgeText}>{t('closet.hub.capsuleScore.proBadge')}</Text>
                  </>
                }
                // Teaser only — the score itself still shows, but the detailed
                // breakdown (ColorDnaModal's equivalent for this tile) is the
                // paywalled part. Real paywall (subscription screen) TBD; this
                // is the UI lock ahead of it.
                onPress={() =>
                  Alert.alert(
                    t('closet.hub.capsuleScore.premiumAlertTitle'),
                    t('closet.hub.capsuleScore.premiumAlertMessage')
                  )
                }
              />
            </FadeInView>
          </View>

          <Text style={styles.sectionLabel}>{t('closet.hub.planAheadLabel')}</Text>
          <FadeInView delay={180}>
            <CopilotStep text={t('closet.tour.plannerCard')} order={2} name="plannerCard">
              <CopilotView>
                <BentoTile
                  wide
                  tint="sage"
                  icon={<Feather name="calendar" size={19} color={colors.textPrimary} />}
                  title={t('closet.hub.planner.title')}
                  subtitle={t('closet.hub.planner.subtitle')}
                  onPress={() => navigation.navigate('Planner')}
                />
              </CopilotView>
            </CopilotStep>
          </FadeInView>

          <Text style={styles.sectionLabel}>{t('closet.hub.shopYourClosetLabel')}</Text>
          <View style={styles.bentoRow}>
            <FadeInView delay={220} style={styles.bentoRowItem}>
              <BentoTile
                square
                icon={<MaterialCommunityIcons name="hanger" size={20} color={colors.accent} />}
                title={t('closet.hub.catalogWidget.title')}
                subtitle={t('closet.hub.catalogWidget.subtitle', { count: wardrobe.length })}
                onPress={() => setView('catalog')}
              />
            </FadeInView>

            <FadeInView delay={260} style={styles.bentoRowItem}>
              <BentoTile
                square
                icon={
                  copilotAnalyzing ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Feather name="search" size={20} color={colors.accent} />
                  )
                }
                title={t('closet.hub.shoppingCopilot.title')}
                subtitle={t('closet.hub.shoppingCopilot.subtitle')}
                onPress={handleShoppingCopilot}
              />
            </FadeInView>
          </View>

          <Text style={styles.sectionLabel}>{t('closet.hub.colorDna.title')}</Text>
          <FadeInView delay={300}>
            <ColorDnaTile palette={palette} onPress={() => setColorDnaModalVisible(true)} />
          </FadeInView>

          <FadeInView delay={340}>
            <View style={styles.impactSection}>
              <Text style={styles.sectionLabel}>{t('closet.hub.impact.title')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.impactScroll}
              >
                <ImpactMiniCard
                  icon="award"
                  value={`${ecoScore}`}
                  label={t('closet.hub.impact.ecoScore')}
                />
                <ImpactMiniCard
                  icon="refresh-cw"
                  value={`${lifecycle.activePercent}%`}
                  label={t('closet.hub.impact.inRotation')}
                />
              </ScrollView>
            </View>
          </FadeInView>

          {(error || wardrobeError) && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error || wardrobeError}</Text>
            </View>
          )}
        </View>

        <FadeInView delay={400}>
          <View style={styles.inspirationSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>{t('closet.hub.inspiration.title')}</Text>
              <Text style={styles.sectionHeaderNote}>{t('closet.hub.inspiration.comingSoon')}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.inspirationScroll}
            >
              {INSPIRATION_TAGS.map((tag) => (
                <InspirationMiniCard
                  key={tag.id}
                  icon={tag.icon}
                  label={t(`closet.hub.inspiration.tags.${tag.id}`)}
                />
              ))}
            </ScrollView>
          </View>
        </FadeInView>
      </ScrollView>

      <ColorDnaModal
        visible={colorDnaModalVisible}
        palette={palette}
        onClose={() => setColorDnaModalVisible(false)}
      />

      <FadeInView delay={360} style={styles.addItemFloating}>
        <CopilotStep text={t('closet.tour.scanButton')} order={1} name="scanButton">
          <CopilotTouchable
            style={styles.addItemTile}
            onPress={handleScan}
            disabled={analyzing}
            activeOpacity={0.85}
          >
            {analyzing ? (
              <ActivityIndicator size="small" color={colors.inverseText} />
            ) : (
              <Feather name="plus" size={18} color={colors.inverseText} />
            )}
            <Text style={styles.addItemTitle}>{t('closet.hubActions.addItem')}</Text>
          </CopilotTouchable>
        </CopilotStep>
      </FadeInView>
    </Animated.View>
  );
}

// `tint` (one of 'violet'|'coral'|'sky'|'sage') swaps the default glass fill
// + soft shadow for a solid pastel `cardTints` fill + matching-hue border,
// no shadow — the redesign's "one confident color per section" tile
// (Style Streak, Capsule Score, Weekly Planner link). Left unset, the tile
// keeps the original white/glass treatment (Catalog, Shopping Copilot,
// Color DNA — the brief explicitly keeps those "white/glass").
function BentoTile({ wide, square, tint, icon, title, subtitle, badge, onPress }) {
  function handlePress() {
    triggerHaptic();
    onPress?.();
  }

  // Explicitly zeroes out `styles.bentoTile`'s shadow (rather than just
  // omitting these keys) since RN merges style objects left-to-right —
  // leaving them out would let the base tile's shadow show through
  // underneath the solid tint, which the brief's flat tinted tiles don't
  // have.
  const tintStyle = tint
    ? {
        backgroundColor: cardTints[tint],
        borderWidth: 1,
        borderColor: TINT_BORDERS[tint],
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
      }
    : null;

  return (
    <TouchableOpacity
      style={[styles.bentoTile, wide && styles.bentoWide, square && styles.bentoSquare, tintStyle]}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      {badge && <View style={styles.proBadge}>{badge}</View>}
      <View style={[styles.bentoIconWrap, tint && styles.bentoIconWrapOnTint]}>{icon}</View>
      <View style={styles.bentoTextWrap}>
        <Text style={styles.bentoTitle} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        <Text style={styles.bentoSubtitle} numberOfLines={1} ellipsizeMode="tail">
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// Compact "Wardrobe Impact" strip — Eco-Score + Lifecycle (ex-ImpactScreen
// logic, via calculateEcoScore/calculateWardrobeLifecycle in wardrobeUtils),
// folded into the Hub as a horizontal-scroll pair of mini stat cards instead
// of its own tab. Sage (colors.success) rather than the Hub's violet accent —
// keeps the "sustainability" read distinct from ordinary CTAs.
function ImpactMiniCard({ icon, value, label }) {
  return (
    <View style={styles.impactMiniCard}>
      <View style={styles.impactMiniIconWrap}>
        <Feather name={icon} size={14} color={colors.success} />
      </View>
      <Text style={styles.impactMiniValue}>{value}</Text>
      <Text style={styles.impactMiniLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// "Style Inspiration" mini card — same mood-board idea as the old
// standalone Inspiration tab's placeholder grid, shrunk to a single
// horizontal-scroll row so it reads as a taste-setting strip, not a
// destination screen of its own.
function InspirationMiniCard({ icon, label }) {
  return (
    <View style={styles.inspirationMiniCard}>
      <View style={styles.inspirationMiniIconWrap}>
        <Feather name={icon} size={20} color={colors.textMuted} />
      </View>
      <Text style={styles.inspirationMiniLabel}>{label}</Text>
    </View>
  );
}

// Gamification: consecutive days the client planned a look (via Save to
// Planner in the AI Stylist chat). Purely a read of usePlannerStore's
// scheduledOutfits through getStyleStreak() — no separate counter to keep
// in sync. Tapping explains the mechanic rather than navigating anywhere,
// same pattern as the Capsule Score tile above.
function StyleStreakTile() {
  const { t } = useTranslation();
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const streak = useMemo(() => getStyleStreak(scheduledOutfits), [scheduledOutfits]);

  function handlePress() {
    triggerHaptic();
    Alert.alert(t('closet.hub.styleStreak.alertTitle'), t('closet.hub.styleStreak.alertMessage'));
  }

  return (
    <BentoTile
      square
      tint="coral"
      icon={<MaterialCommunityIcons name="fire" size={18} color={colors.textPrimary} />}
      title={t('closet.hub.styleStreak.count', { count: streak })}
      subtitle={streak > 0 ? t('closet.hub.styleStreak.subtitleActive') : t('closet.hub.styleStreak.subtitleEmpty')}
      onPress={handlePress}
    />
  );
}

// "Smart Daily Target" — hero card whose challenge text is generated from
// the client's Fit Profile + today's weather (generateDailyChallenge in
// utils/dailyChallengeEngine.js), not a static rotating list. Deterministic
// per calendar day, so it only changes at local midnight — re-renders within
// the same day (e.g. weather resolving from 'loading' to 'ready') can shift
// which signal wins, but never on every render.
//
// Completion is a plain dateKey -> true map in usePlannerStore
// (toggleChallenge), independent of *what* the target is — that's what makes
// it survive an app restart on the same day. Tapping the tile is the "mark
// done" action; the background/text/icon transition is driven by Reanimated
// (`progress` 0->1) rather than the RN Animated API the rest of this file
// uses, so the color cross-fade runs smoothly on the UI thread.
const CHALLENGE_TRANSITION_MS = 320;

function DailyChallengeTile() {
  const { t } = useTranslation();
  const skinTone = useUserStore((state) => state.skinTone);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const bodyType = useUserStore((state) => state.bodyType);
  const completedChallenges = usePlannerStore((state) => state.completedChallenges);
  const toggleChallenge = usePlannerStore((state) => state.toggleChallenge);
  const weather = useWeather();

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const challenge = useMemo(
    () => generateDailyChallenge({ skinTone, hairColor, eyeColor, bodyType }, weather),
    [skinTone, hairColor, eyeColor, bodyType, weather.status, weather.condition, weather.temperature]
  );
  const isDone = Boolean(completedChallenges[todayKey]);

  const progress = useSharedValue(isDone ? 1 : 0);
  const bounce = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(isDone ? 1 : 0, { duration: CHALLENGE_TRANSITION_MS });
  }, [isDone]);

  // Card flips from a light violet tint to the solid, saturated violet
  // accent when done — title/caption need to cross-fade from ink to white
  // alongside it to stay legible on both. The badge itself doesn't (its
  // white pill fill never changes, only its text content does).
  const animatedCardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [cardTints.violet, colors.accent]),
  }));
  const animatedIconWrapStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['rgba(108,77,246,0.12)', 'rgba(255,255,255,0.2)']),
  }));
  const animatedTitleStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.textPrimary, colors.inverseText]),
  }));
  const animatedCaptionStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.textSecondary, 'rgba(255,255,255,0.8)']),
  }));

  function handlePress() {
    triggerHaptic();
    bounce.value = withSequence(withTiming(0.98, { duration: 90 }), withTiming(1, { duration: 160 }));
    toggleChallenge(todayKey);
  }

  return (
    <Reanimated.View style={[styles.heroCard, animatedCardStyle, { transform: [{ scale: bounce.value }] }]}>
      <View style={styles.heroBlob} />
      <TouchableOpacity style={styles.heroTouchable} onPress={handlePress} activeOpacity={0.9}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>
            {isDone ? t('closet.hub.dailyChallenge.doneBadge') : t('closet.hub.dailyChallenge.badge')}
          </Text>
        </View>
        <Reanimated.Text style={[styles.heroTitle, animatedTitleStyle]} numberOfLines={2}>
          {challenge.title}
        </Reanimated.Text>
        <View style={styles.heroFooterRow}>
          <Reanimated.View style={[styles.heroIconWrap, animatedIconWrapStyle]}>
            <Feather name={isDone ? 'check' : challenge.icon} size={14} color={isDone ? colors.inverseText : colors.violet} />
          </Reanimated.View>
          <Reanimated.Text style={[styles.heroCaption, animatedCaptionStyle]} numberOfLines={1}>
            {isDone ? t('closet.hub.dailyChallenge.doneSubtitle') : t('closet.hub.dailyChallenge.subtitle')}
          </Reanimated.Text>
        </View>
      </TouchableOpacity>
    </Reanimated.View>
  );
}

// Maps the same condition buckets useWeather() returns to a representative
// Feather glyph — Feather has no dedicated "fog" icon, so fog/unknown/loading
// all fall back to a plain cloud.
const WEATHER_ICONS = {
  clear: 'sun',
  cloudy: 'cloud',
  rain: 'cloud-rain',
  snow: 'cloud-snow',
  storm: 'cloud-lightning',
  fog: 'cloud',
  unknown: 'cloud',
};

// Real forecast via useWeather() (foreground location -> reverse geocode ->
// Open-Meteo, no API key). Self-contained: reads the chat store and
// navigation itself rather than taking callback props.
function WeatherWidget() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const setPendingPrompt = useChatStore((state) => state.setPendingPrompt);
  const weather = useWeather();
  const [manualCityModalVisible, setManualCityModalVisible] = useState(false);

  const isReady = weather.status === 'ready';
  const conditionText = isReady ? t(`closet.hub.weather.conditions.${weather.condition}`) : '';
  const cityText = weather.city || t('closet.hub.weather.unknownCity');

  const mainText = isReady
    ? `${weather.temperature}°C, ${cityText}`
    : weather.status === 'error'
    ? t('closet.hub.weather.unavailable')
    : t('closet.hub.weather.loading');

  function handleDressMe() {
    if (!isReady) return;
    triggerHaptic();
    const prompt = t('closet.hub.weather.dressMePrompt', {
      city: cityText,
      temperature: weather.temperature,
      condition: conditionText,
    });
    setPendingPrompt(prompt);
    navigation.navigate('AI Stylist');
  }

  function handleCityEditPress() {
    triggerHaptic();
    setManualCityModalVisible(true);
  }

  return (
    <View style={styles.weatherTile}>
      <View style={styles.bentoIconWrap}>
        <Feather name={WEATHER_ICONS[weather.condition] || 'cloud'} size={22} color={colors.accent} />
      </View>
      <View style={styles.weatherTextWrap}>
        {/* City name is itself the edit trigger — a VPN or an imprecise
            device location means GPS-based weather can't always be trusted,
            so this is the escape hatch to force a specific city. */}
        <TouchableOpacity
          style={styles.weatherCityRow}
          onPress={handleCityEditPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.weatherTemp} numberOfLines={1}>
            {mainText}
          </Text>
          <Feather name="edit-2" size={12} color={colors.textMuted} />
        </TouchableOpacity>
        {isReady && (
          <Text style={styles.weatherSubtitle} numberOfLines={1}>
            {conditionText}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={[styles.dressMeBtn, !isReady && styles.dressMeBtnDisabled]}
        onPress={handleDressMe}
        disabled={!isReady}
        activeOpacity={0.8}
      >
        <Text style={styles.dressMeBtnText}>{t('closet.hub.weather.dressMe')}</Text>
        <Feather name="arrow-right" size={13} color={colors.inverseText} />
      </TouchableOpacity>

      <ManualCityModal
        visible={manualCityModalVisible}
        onClose={() => setManualCityModalVisible(false)}
        onSubmit={weather.submitManualCity}
      />
    </View>
  );
}

// Sheet — blurred/dimmed backdrop, one input, two pill actions. Validates
// the city (via useWeather's submitManualCity) before closing, so a typo
// surfaces inline instead of silently leaving the widget stuck on
// "Detecting weather...".
function ManualCityModal({ visible, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [cityInput, setCityInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setCityInput('');
      setError(null);
    }
  }, [visible]);

  async function handleApply() {
    const trimmed = cityInput.trim();
    if (!trimmed || submitting) return;

    triggerHaptic();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(t('closet.hub.weather.manualCityError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.cityModalBackdrop} onPress={onClose}>
        <Pressable style={styles.cityModalSheet} onPress={() => {}}>
          <Text style={styles.cityModalTitle}>{t('closet.hub.weather.manualCityTitle')}</Text>
          <TextInput
            style={styles.cityModalInput}
            value={cityInput}
            onChangeText={setCityInput}
            placeholder={t('closet.hub.weather.manualCityPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleApply}
          />
          {error && <Text style={styles.cityModalError}>{error}</Text>}

          <View style={styles.cityModalActions}>
            <TouchableOpacity
              style={styles.cityModalCancelBtn}
              onPress={() => {
                triggerHaptic();
                onClose();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.cityModalCancelBtnText}>{t('closet.hub.weather.manualCityCancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.cityModalApplyBtn,
                (!cityInput.trim() || submitting) && styles.cityModalApplyBtnDisabled,
              ]}
              onPress={handleApply}
              disabled={!cityInput.trim() || submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.inverseText} />
              ) : (
                <Text style={styles.cityModalApplyBtnText}>{t('closet.hub.weather.manualCityApply')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Bento tile for "Color DNA" — swaps BentoTile's icon circle for a small row
// of swatches from the top of the client's `best` palette, so the tile
// itself previews the answer before they even tap into the modal. Kept as
// its own component (not BentoTile) since its content row differs enough
// (swatches instead of a single icon) that forcing it through BentoTile's
// icon prop would need its own escape hatch anyway.
function ColorDnaTile({ palette, onPress }) {
  const { t } = useTranslation();

  function handlePress() {
    triggerHaptic();
    onPress?.();
  }

  return (
    <TouchableOpacity style={styles.colorDnaCard} onPress={handlePress} activeOpacity={0.85}>
      <View style={styles.colorDnaSwatchRow}>
        {palette.best.slice(0, 4).map((color) => (
          <View key={color.hex} style={[styles.colorDnaSwatch, { backgroundColor: color.hex }]} />
        ))}
      </View>
      <View style={styles.bentoTextWrap}>
        <Text style={styles.bentoTitle} numberOfLines={1}>
          {t('closet.hub.colorDna.subtitle')}
        </Text>
        <Text style={styles.bentoSubtitle} numberOfLines={1}>
          {t('closet.hub.colorDna.modalTitle')}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// Best/Avoid breakdown behind the Color DNA tile — same backdrop-press-to-
// dismiss modal pattern as StylistScreen's "save to planner" sheet, no
// separate close button needed.
function ColorDnaModal({ visible, palette, onClose }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.colorDnaBackdrop} onPress={onClose}>
        <Pressable style={styles.colorDnaSheet} onPress={() => {}}>
          <Text style={styles.colorDnaSheetTitle}>{t('closet.hub.colorDna.modalTitle')}</Text>

          <Text style={styles.colorDnaGroupLabel}>{t('closet.hub.colorDna.bestColors')}</Text>
          <View style={styles.colorDnaSwatchList}>
            {palette.best.map((color) => (
              <View key={color.hex} style={styles.colorDnaSwatchRowItem}>
                <View style={[styles.colorDnaSwatchLg, { backgroundColor: color.hex }]} />
                <Text style={styles.colorDnaSwatchName}>{color.name}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.colorDnaGroupLabel, styles.colorDnaAvoidLabel]}>
            {t('closet.hub.colorDna.avoidColors')}
          </Text>
          <View style={styles.colorDnaSwatchList}>
            {palette.avoid.map((color) => (
              <View key={color.hex} style={styles.colorDnaSwatchRowItem}>
                <View style={[styles.colorDnaSwatchLg, { backgroundColor: color.hex }]} />
                <Text style={styles.colorDnaSwatchName}>{color.name}</Text>
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EditableRow({ label, value, expanded, onPress, children }) {
  return (
    <View style={styles.editableRow}>
      <TouchableOpacity style={styles.editableRowHeader} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.editableLabel}>{label}</Text>
        <View style={styles.editableValueWrap}>
          <Text style={styles.editableValue}>{value}</Text>
          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textSecondary}
          />
        </View>
      </TouchableOpacity>
      {expanded && children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hubContainer: { backgroundColor: colors.premiumBackground },

  // Wardrobe Hub — Bento dashboard
  hubScroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    // paddingTop set inline above, from real safe-area top inset — not a
    // fixed guess, so it clears the notch/status bar on any device.
    // Extra room at the bottom so the last row can scroll clear of the
    // floating Add Item bar instead of disappearing under it.
    paddingBottom: spacing.xxxl + 64,
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 10, marginBottom: 22 },
  avatar: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.inverseText, fontSize: 13, fontWeight: '800' },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerGreeting: { fontFamily: typography.title.fontFamily, fontWeight: '800', fontSize: 16, color: colors.textPrimary },
  headerDate: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginTop: 1 },

  // Vertical stack: Weather, hero challenge, stat row, planner link,
  // catalog/copilot row, color DNA — all spaced by the same 16px gap used
  // horizontally in `bentoRow`, so the grid geometry is even in both
  // directions.
  bentoGrid: {
    gap: spacing.sm,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // Lets FadeInView's wrapping Animated.View pass through the `flex: 1` that
  // `bentoSquare` needs to sit side-by-side in a row (see bentoSquare below).
  bentoRowItem: { flex: 1 },

  // Glassmorphism: translucent white over the cream canvas, soft diffuse
  // shadow instead of a hard border — used by tiles that stay "white/glass"
  // per the brief (Catalog, Shopping Copilot, Color DNA). Tinted tiles
  // (`tint` prop on BentoTile) override backgroundColor and drop the shadow.
  bentoTile: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    padding: spacing.sm,
    justifyContent: 'space-between',
    ...shadows.soft,
  },
  bentoWide: { width: '100%', minHeight: 108 },
  // `flex: 1` (not a `%` width) so two tiles plus the row's `gap` always sum
  // to exactly the row's width — a percentage width would overflow once the
  // gap is added and wrap to its own line instead of sitting side by side.
  bentoSquare: { flex: 1, aspectRatio: 1 },

  // Accent-tinted icon chip (violet, low opacity) for white/glass tiles.
  bentoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: BENTO_RADIUS - 6,
    backgroundColor: 'rgba(108, 77, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On a tinted tile, the icon chip sits on top of a solid pastel fill —
  // a plain white chip reads better there than the violet-tinted one above.
  bentoIconWrapOnTint: { backgroundColor: 'rgba(255,255,255,0.6)' },
  // PRO lock badge — top-right corner of a gated tile. Monochrome so it
  // never reads as a second primary action.
  proBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
    zIndex: 1,
  },
  proBadgeText: { fontSize: 9, fontWeight: '700', color: colors.inverseText, letterSpacing: 0.5 },

  // Shared small section header — matches typography.label styling used
  // elsewhere in the app for section eyebrows.
  sectionLabel: { ...typography.label, marginBottom: spacing.xs },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionHeaderNote: { fontSize: 11, color: colors.textMuted },

  // Hero challenge card — full-width, violet-tinted (solid, not glass),
  // with a soft decorative "blob" in the top-right corner. True CSS
  // radial-gradient isn't available in plain RN Views, so the blob is a
  // flat semi-transparent circle — a reasonable simplification of the
  // mockup's radial glow at this fidelity.
  heroCard: {
    borderRadius: radius.cardLg,
    padding: spacing.md,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBlob: {
    position: 'absolute',
    top: -26,
    right: -26,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(108,77,246,0.18)',
  },
  heroTouchable: { gap: 10 },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  heroBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.violet },
  heroTitle: { fontSize: 20, fontWeight: '800', lineHeight: 25, maxWidth: '72%' },
  heroFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroIconWrap: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  heroCaption: { fontSize: 12, fontWeight: '600' },

  // "Wardrobe Impact" — Eco-Score + Lifecycle mini cards (ex-ImpactScreen).
  impactSection: { width: '100%' },
  impactScroll: { gap: spacing.xs, paddingRight: spacing.md },
  impactMiniCard: {
    width: 132,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    padding: spacing.sm,
    ...shadows.soft,
  },
  impactMiniIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(62, 143, 99, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  impactMiniValue: { ...typography.title, fontSize: 26, fontWeight: 'bold', color: colors.textPrimary },
  impactMiniLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  // "Style Inspiration" — mood-board taster strip (ex-Inspiration tab).
  inspirationSection: { marginTop: spacing.lg },
  inspirationScroll: { gap: spacing.xs, paddingRight: spacing.md, paddingBottom: spacing.xs },
  inspirationMiniCard: {
    width: 104,
    height: 128,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    ...shadows.soft,
  },
  inspirationMiniIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspirationMiniLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  bentoTextWrap: { marginTop: spacing.sm },
  bentoTitle: { ...typography.title, fontSize: 16, fontWeight: '700' },
  bentoSubtitle: { ...typography.bodySecondary, fontSize: 13, marginTop: 2, fontWeight: '500' },

  // Weather widget — a horizontal status bar (icon + text + action), not a
  // BentoTile, so it stays compact instead of matching the taller tiles.
  weatherTile: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    ...shadows.soft,
  },
  weatherTextWrap: { flex: 1 },
  weatherCityRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  weatherTemp: { ...typography.title, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  weatherSubtitle: { ...typography.bodySecondary, fontSize: 12, marginTop: 2, fontWeight: '500' },
  dressMeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  dressMeBtnText: { fontSize: 12, fontWeight: '700', color: colors.inverseText },
  dressMeBtnDisabled: { opacity: opacity.disabled },

  cityModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  cityModalSheet: {
    backgroundColor: colors.premiumBackground,
    borderRadius: radius.card,
    padding: spacing.md,
    ...shadows.soft,
  },
  cityModalTitle: { ...typography.title, fontWeight: '600', marginBottom: spacing.sm },
  cityModalInput: {
    ...hairline,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  cityModalError: { fontSize: 12, color: colors.danger, marginTop: spacing.xs },
  cityModalActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  cityModalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cityModalCancelBtnText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  cityModalApplyBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cityModalApplyBtnDisabled: { opacity: opacity.disabled },
  cityModalApplyBtnText: { fontSize: 15, fontWeight: '600', color: colors.inverseText },

  // Color DNA — bespoke card (not BentoTile) since its content row is
  // swatches, not a single icon.
  colorDnaCard: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    padding: spacing.sm,
    ...shadows.soft,
  },
  colorDnaSwatchRow: { flexDirection: 'row', gap: 6 },
  colorDnaSwatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
    ...shadows.sm,
  },
  colorDnaBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  colorDnaSheet: {
    backgroundColor: colors.premiumBackground,
    borderRadius: radius.card,
    padding: spacing.md,
    ...shadows.soft,
  },
  colorDnaSheetTitle: { ...typography.title, fontWeight: '600', marginBottom: spacing.md },
  colorDnaGroupLabel: { ...typography.label, marginBottom: spacing.xs },
  colorDnaAvoidLabel: { marginTop: spacing.md },
  colorDnaSwatchList: { gap: spacing.xs },
  colorDnaSwatchRowItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  colorDnaSwatchLg: {
    width: 24,
    height: 24,
    borderRadius: 12,
    ...shadows.sm,
  },
  colorDnaSwatchName: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },

  // Primary CTA of the Hub — solid violet fill, no border, colored glow
  // (shadows.accent) so it outweighs every card around it. Rendered as a
  // fixed row above the (now docked, not absolute) custom tab bar — see
  // TabNavigator.js — rather than inside the header, per the redesign.
  addItemTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: 32,
    ...shadows.accent,
  },
  // Floats above the ScrollView as a fixed footer, centered like the
  // mockup's "+ Add item" pill (not a full-width bar anymore).
  addItemFloating: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 20,
    alignItems: 'center',
  },
  addItemTitle: { color: colors.inverseText, fontWeight: '800', fontSize: 14.5 },

  errorBox: {
    width: '100%',
    padding: spacing.sm,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    ...shadows.soft,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  // Confirmation step (unchanged scanning flow)
  confirmScroll: { paddingBottom: spacing.md },
  confirmImage: { width: '100%', height: 340, backgroundColor: colors.surface },
  confirmBody: { padding: spacing.md },
  confirmTitle: { ...typography.title, marginBottom: spacing.xs },
  editableRow: { ...hairline, paddingVertical: spacing.sm },
  editableRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editableLabel: { ...typography.label },
  editableValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editableValue: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },

  confirmErrorBox: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    ...shadows.soft,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  discardBtn: { ...buttons.secondary, flex: 1 },
  discardBtnText: { ...buttons.secondaryText, fontSize: 15 },
  confirmBtn: { ...buttons.primary, flex: 1, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { ...buttons.primaryText, fontSize: 15 },
  confirmActionDisabled: { opacity: opacity.disabled },
});
