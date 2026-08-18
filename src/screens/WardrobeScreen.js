import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { analyzeShoppingItem } from '../services/aiShoppingCopilot';
import { readImageAsBase64 } from '../utils/imageBase64';
import { getPalette } from '../utils/colorDna';
import { calculateCohesionScore, calculateInsights } from '../utils/wardrobeUtils';
import InsightsCard from '../components/InsightsCard';
import { generateDailyChallenge } from '../utils/dailyChallengeEngine';
import { useUserStore } from '../store/useUserStore';
import { isAdminTelegramId } from '../utils/admin';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useChatStore } from '../store/useChatStore';
import { usePlannerStore, toDateKey, getStyleStreak } from '../store/usePlannerStore';
import { useFadeOnFocus } from '../hooks/useFadeOnFocus';
import { useWeather } from '../hooks/useWeather';
import { colors, cardTints, spacing, radius, hairline, shadows, opacity, typography, fonts, withAlpha } from '../theme/tokens';
import WardrobeCatalogScreen from './WardrobeCatalogScreen';
import ScreenContainer from '../components/ScreenContainer';
import { FadeInView, AnimatedPressable } from '../components/AnimatedPressable';
import GeneratedItemThumb from '../components/GeneratedItemThumb';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { usePaywall } from '../hooks/usePaywall';
import ScanSheet from '../components/ScanSheet';
import LockableTile from '../components/LockableTile';
import Toast from '../components/Toast';
import PaywallModal from '../components/PaywallModal';
import Skeleton from '../components/Skeleton';
import { TourTarget } from '../components/AppTour';
import ColorDnaCalibrationSheet from '../components/ColorDnaCalibrationSheet';
import { triggerHaptic } from '../utils/haptics';
import { FREE_WARDROBE_LIMIT } from '../constants/monetization';

// Radius for icon chips. The Hub's own cards use `radius.card` (redesign
// v2) — this constant lives on for the pieces that didn't move (icon chips,
// the confirm-scan flow).
const BENTO_RADIUS = 20;

export default function WardrobeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const user = useUserStore((state) => state.user);
  const wardrobe = useWardrobeStore((state) => state.items);
  const wardrobeLoading = useWardrobeStore((state) => state.loading);
  const wardrobeError = useWardrobeStore((state) => state.error);
  const fetchWardrobe = useWardrobeStore((state) => state.fetchWardrobe);
  const addItem = useWardrobeStore((state) => state.addItem);
  const inspirations = useWardrobeStore((state) => state.inspirations);
  const inspirationsLoading = useWardrobeStore((state) => state.inspirationsLoading);
  const fetchInspirations = useWardrobeStore((state) => state.fetchInspirations);
  const fetchOutfits = usePlannerStore((state) => state.fetchOutfits);
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const skinTone = useUserStore((state) => state.skinTone);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const styleVibes = useUserStore((state) => state.styleVibes);
  const isPro = useUserStore((state) => state.isPro);
  const bonusWardrobeSlots = useUserStore((state) => state.bonusWardrobeSlots);
  const fadeOpacity = useFadeOnFocus();

  // 'hub' is the landing view (title/description + the two actions below);
  // 'catalog' drills into the category-grouped item browser. Kept as local
  // state rather than a nav stack — this tab has no other navigation depth.
  // Weekly Planner used to be a third nested view here too — it's now its
  // own `Planner` tab (see TabNavigator.js/PlannerScreen.js). The scan flow
  // itself (photo -> AI analysis -> save) no longer lives here as a state
  // machine — it's ScanSheet's own self-contained bottom sheet, opened via
  // `scanSheetVisible` below.
  const [view, setView] = useState('hub');
  // Top-level split of the hub itself — 'items' is everything the hub
  // already showed (Bento dashboard); 'inspirations' swaps that for the
  // saved-look grid (see useWardrobeStore's inspirations/saveInspiration).
  // Independent of `view` above: the catalog drill-down is reached FROM
  // the 'items' section specifically, not a sibling of this split.
  const [section, setSection] = useState('items');
  const [scanSheetVisible, setScanSheetVisible] = useState(false);
  const [copilotAnalyzing, setCopilotAnalyzing] = useState(false);
  const [colorDnaModalVisible, setColorDnaModalVisible] = useState(false);
  const { toastMessage, toastKey, toastHoldMs, showToast } = useToast();
  const { paywallMessage, showPaywall, closePaywall } = usePaywall();

  const palette = useMemo(() => getPalette(skinTone, hairColor, eyeColor), [skinTone, hairColor, eyeColor]);
  // Progressive Profiling gate — Deferred Registration stopped collecting
  // these three at Onboarding, so `getPalette` above would otherwise run on
  // silent null-input defaults the first time any client (guest or not)
  // opens Color DNA. ColorDnaTile's onPress below opens
  // ColorDnaCalibrationSheet instead of ColorDnaModal while this is true;
  // once the sheet's Continue saves all three, this flips false on its own
  // (reactive selectors above) and the very next render swaps to the real
  // results, no separate "done" callback needed.
  const needsColorDnaCalibration = !hairColor || !eyeColor || !skinTone;
  const cohesionScore = useMemo(() => calculateCohesionScore(wardrobe), [wardrobe]);
  const insights = useMemo(() => calculateInsights(wardrobe, scheduledOutfits), [wardrobe, scheduledOutfits]);
  // Gated on !wardrobeLoading too — otherwise the very first render (before
  // the fetch resolves, `wardrobe` still `[]`) would flash the empty-state
  // hero even for a client who actually has items, right before the real
  // list snaps in. Admin's own account never locks these — its whole point
  // is exercising every feature regardless of what test data happens to be
  // in its closet at the time.
  const isEmptyCloset = !isAdminTelegramId(user?.telegramId) && !wardrobeLoading && wardrobe.length === 0;

  const hubScrollRef = useRef(null);
  const pagerRef = useRef(null);
  const { width: screenWidth } = useWindowDimensions();
  // Drives the SectionSwitcher's sliding active-pill — a direct read of the
  // pager's own horizontal scroll offset, not a separate animation someone
  // has to keep in sync by hand. Real state-transition motion (position IS
  // scroll progress), not a decorative loop.
  const pagerScrollX = useRef(new Animated.Value(0)).current;

  // Swipe navigation between the Items/Inspirations pages (Section
  // Switcher's own two tabs) — a plain `ScrollView horizontal pagingEnabled`
  // rather than a new native-module dependency (no react-native-pager-view/
  // react-native-tab-view in this project, and neither is worth adding just
  // for a fixed 2-page swap). `handleSectionChange` drives the pager from a
  // switcher tap; `handlePagerScrollEnd` drives the switcher's own active
  // pill from a swipe — same `section` state, two ways to move it.
  function handleSectionChange(next) {
    setSection(next);
    pagerRef.current?.scrollTo({ x: next === 'inspirations' ? screenWidth : 0, animated: true });
  }

  function handlePagerScrollEnd(event) {
    const pageIndex = Math.round(event.nativeEvent.contentOffset.x / screenWidth);
    setSection(pageIndex === 1 ? 'inspirations' : 'items');
  }

  // Closet is a lazy tab (React Navigation only mounts it on first visit),
  // so this only fires once per session, right when the client actually
  // opens it — not at app boot for a tab they may never open. fetchOutfits
  // rides along because the Style Streak tile below needs scheduledOutfits
  // too, and Closet is often the first tab opened in a session (before the
  // Planner tab itself, which also fetches on its own mount).
  useEffect(() => {
    fetchWardrobe().then(fetchOutfits);
    fetchInspirations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App Tour walkthrough retired (product decision — the empty-closet
  // coach-mark tour that used to auto-start here is gone; the onboarding
  // screens now explain the app up front instead). `AppTour.js`'s
  // infrastructure (TourTarget wrappers below, AppTourProvider in App.js)
  // is left in place but permanently inert without this effect ever
  // calling `startTour` — every TourTarget is a harmless no-op measure
  // call with nothing left to read its rect.
  //
  // The two ScrollViews' own `scrollEnabled={!tour?.isTourActive}` props
  // were NOT harmless, though, and are gone entirely (not just left
  // inert) — confirmed on web, react-native-web renders a ScrollView with
  // `scrollEnabled={false}` as literal CSS `overflow: hidden` rather than
  // `auto`, permanently un-scrollable regardless of what `tour?.isTourActive`
  // itself evaluated to. That was the actual cause of "the screen won't
  // scroll, the tab bar and Add Item button are unreachable" once the tour
  // stopped running — not the `flex:1`-missing bug fixed alongside this
  // one, which was real but insufficient on its own.

  function handleScan() {
    triggerHaptic();

    // Freemium wardrobe cap — blocks BEFORE the sheet ever opens (the real
    // backstop, for any path that somehow gets here anyway, lives in
    // useWardrobeStore's own addItem). Checked against the live `wardrobe`
    // this component already subscribes to, so it can never go stale the
    // way a value captured once at mount would.
    if (!isPro && wardrobe.length >= FREE_WARDROBE_LIMIT + bonusWardrobeSlots) {
      showPaywall(t('paywall.wardrobeLimitMessage'));
      return;
    }

    setScanSheetVisible(true);
  }

  // Fires when the client taps a tile that's locked (see isEmptyCloset +
  // LockableTile below) — a soft nudge rather than a hard wall, so tapping
  // Planner/Color DNA/Shopping Co-pilot/Inspiration with zero items still
  // feels responsive instead of dead.
  function handleLockedTilePress() {
    triggerHaptic();
    showToast(t('closet.hub.lockedTile.message'));
  }

  // Snaps a candidate purchase in-store and asks the AI for a quick "Buy or
  // Pass" verdict against the client's capsule score + chosen style vibes.
  // Pro-only — the tile stays visible/tappable on the free tier (per the
  // monetization spec: "keep the entry point in the UI"), it just opens the
  // paywall instead of the camera. Checked before even asking for camera
  // permission, so a free client never sees an OS permission prompt for a
  // feature they can't actually use yet.
  async function handleShoppingCopilot() {
    if (copilotAnalyzing) return;

    if (!isPro) {
      showPaywall(t('paywall.shoppingCopilotMessage'));
      return;
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      showToast(t('closet.hub.shoppingCopilot.cameraPermissionMessage'));
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
      // Longer hold than the default toast — this is a verdict + a full
      // sentence of reasoning the client actually needs to read, not a
      // quick one-word confirmation.
      showToast(`${verdict}: ${reasoning}`, 3200);
    } catch (err) {
      showToast(err.message || t('closet.scan.genericError'));
    } finally {
      setCopilotAnalyzing(false);
    }
  }

  // ---- Category browser ----
  // `ScanSheet` is rendered here too (not just from the Hub branch below) —
  // it used to live ONLY in the Hub's own JSX tree, which is why
  // `onAddItem` had to `setView('hub')` before `handleScan()`: without that,
  // the sheet had nowhere to mount and silently did nothing. Rendering it
  // as a sibling here lets Catalog open the exact same bottom sheet
  // in-place, no view switch, no redirect back to the Hub underneath it.
  if (view === 'catalog') {
    return (
      <>
        <WardrobeCatalogScreen
          wardrobe={wardrobe}
          loading={wardrobeLoading}
          onBack={() => setView('hub')}
          onAddItem={handleScan}
        />
        <ScanSheet
          visible={scanSheetVisible}
          onClose={() => setScanSheetVisible(false)}
          onSave={addItem}
          palette={palette}
        />
      </>
    );
  }

  // ---- Wardrobe Hub (default landing view) ----
  // scroll=false — this screen's own ScrollView (ref + onScroll + the
  // fade-opacity Animated.View wrapping it) can't collapse into
  // ScreenContainer's built-in one, so ScreenContainer only contributes the
  // safe-area shell here; contentStyle zeroes its own 16px margin out since
  // `hubScroll` below already carries that same spacing.screenH padding on
  // the real scrollable content, one layer in.
  return (
    <ScreenContainer edges={['top']} scroll={false} style={styles.hubContainer} contentStyle={styles.zeroHPadding}>
      <Animated.View style={[styles.flexFill, { opacity: fadeOpacity }]}>

      {/* Fixed above the swipeable pager (not inside either page's own
          ScrollView) so it stays visible and its active pill tracks the
          current page regardless of how far either page is scrolled — see
          `handleSectionChange`/`handlePagerScrollEnd` above for the two ways
          it stays in sync with the pager. */}
      <View style={styles.sectionSwitcherWrap}>
        <SectionSwitcher
          section={section}
          onChange={handleSectionChange}
          scrollX={pagerScrollX}
          screenWidth={screenWidth}
        />
      </View>

      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: pagerScrollX } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handlePagerScrollEnd}
        style={styles.flexFill}
      >
      <View style={{ width: screenWidth, flex: 1 }}>
      <ScrollView
        ref={hubScrollRef}
        style={styles.flexFill}
        contentContainerStyle={[styles.hubScroll, { paddingTop: spacing.sm }]}
      >
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
              <StyleStreakTile showToast={showToast} />
            </FadeInView>

            <FadeInView delay={140} style={styles.bentoRowItem}>
              <BentoTile
                square
                statTile
                dimmed
                tint="sky"
                icon={<Feather name="star" size={14} color={colors.textPrimary} />}
                // Value itself is Pro-only — free tier always sees the
                // placeholder dash, never the real score, regardless of
                // wardrobe state.
                title={!isPro || wardrobe.length === 0 ? '—' : `${cohesionScore}%`}
                // Always "Гармоничность" — used to swap to a distinct
                // empty-wardrobe subtitle, but this tile is now a
                // permanent, static Pro teaser regardless of wardrobe
                // state or tier (see `dimmed`/badge below), so the label
                // itself stays fixed too.
                subtitle={t('closet.hub.capsuleScore.subtitle')}
                // Badge and dimming are now unconditional, not gated on
                // `isPro` — there's no real unlocked state to switch into
                // for EITHER tier (no detailed-breakdown screen exists),
                // so this reads as a permanent "Pro" teaser tile rather
                // than a real toggle between two states.
                badge={
                  <>
                    <Feather name="lock" size={10} color={colors.inverseText} />
                    <Text style={styles.proBadgeText}>{t('closet.hub.capsuleScore.proBadge')}</Text>
                  </>
                }
                // Unconditional, not gated on `isPro` — there's no real
                // detailed-breakdown screen built yet for EITHER tier, so a
                // tap always opens the paywall nudge (which itself routes to
                // Pricing). Was `isPro ? undefined : ...` before, which left
                // the tile completely unresponsive for anyone currently
                // reading as Pro — including every real account today, since
                // `isPro` is temporarily defaulted to `true` app-wide for QA
                // (see useUserStore's own comment on that default).
                onPress={() => showPaywall(t('closet.hub.capsuleScore.premiumAlertMessage'))}
              />
            </FadeInView>
          </View>

          {/* Free-tier stats — dead code from an earlier pass
              (InsightsCard/calculateInsights already existed, never wired
              in anywhere) rendered for real now. Hides itself when there's
              nothing to say yet (see InsightsCard's own guard). */}
          <InsightsCard mostWornItem={insights.mostWornItem} />

          {/* `gap` here replaces the spacing bentoGrid's own `gap` would
              otherwise provide between these sections — was previously a
              single TourTarget wrapping this whole block (Planner card +
              catalog/copilot row + Color DNA card together), which made the
              `plannerCard` tour step spotlight this ENTIRE section instead
              of just the one card it was meant to point at. Plain View now
              — `plannerCard` below wraps only the actual Planner card. */}
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.sectionLabel}>{t('closet.hub.planAheadLabel')}</Text>
            {/* Locked (not hidden) while the closet is empty — see Block 3.5:
                the client should see Planner exists, not have it vanish.
                TourTarget is the OUTERMOST wrapper here (not nested inside
                FadeInView) specifically so its measured box is exactly this
                card's own rendered bounds — neither FadeInView nor
                LockableTile's own wrapper style carries any margin, so
                nothing inflates the spotlight beyond the card itself. */}
            <TourTarget id="plannerCard" borderRadius={radius.card}>
              <FadeInView delay={180}>
                <LockableTile locked={isEmptyCloset} onLockedPress={handleLockedTilePress}>
                  <BentoTile
                    wide
                    icon={<Feather name="calendar" size={19} color={colors.textPrimary} />}
                    title={t('closet.hub.planner.title')}
                    subtitle={t('closet.hub.planner.subtitle')}
                    onPress={() => navigation.navigate('Planner')}
                  />
                </LockableTile>
              </FadeInView>
            </TourTarget>

            <Text style={styles.sectionLabel}>{t('closet.hub.shopYourClosetLabel')}</Text>
            <View style={styles.bentoRow}>
              {/* App Tour's `catalogWidget` step — always mounted (unlike
                  `scanCta`, this tile isn't gated on isEmptyCloset), so its
                  rect is already registered by the time the tour auto-
                  advances into it right after the first scan. */}
              <TourTarget id="catalogWidget" style={styles.bentoRowItem}>
                <FadeInView delay={220}>
                  <BentoTile
                    square
                    icon={<MaterialCommunityIcons name="hanger" size={20} color={colors.accent} />}
                    title={t('closet.hub.catalogWidget.title')}
                    subtitle={t('closet.hub.catalogWidget.subtitle', { count: wardrobe.length })}
                    onPress={() => setView('catalog')}
                  />
                </FadeInView>
              </TourTarget>

              <FadeInView delay={260} style={styles.bentoRowItem}>
                <LockableTile locked={isEmptyCloset} onLockedPress={handleLockedTilePress}>
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
                </LockableTile>
              </FadeInView>
            </View>

            <Text style={styles.sectionLabel}>{t('closet.hub.colorDna.title')}</Text>
            <FadeInView delay={300}>
              <LockableTile locked={isEmptyCloset} onLockedPress={handleLockedTilePress}>
                <ColorDnaTile palette={palette} onPress={() => setColorDnaModalVisible(true)} />
              </LockableTile>
            </FadeInView>
          </View>

          {wardrobeError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{wardrobeError}</Text>
            </View>
          )}
        </View>

      </ScrollView>
      </View>

      <View style={{ width: screenWidth, flex: 1 }}>
        <ScrollView style={styles.flexFill} contentContainerStyle={[styles.hubScroll, { paddingTop: spacing.sm }]}>
          <LookbookSection inspirations={inspirations} loading={inspirationsLoading} />
        </ScrollView>
      </View>
      </Animated.ScrollView>

      {needsColorDnaCalibration ? (
        <ColorDnaCalibrationSheet
          visible={colorDnaModalVisible}
          onClose={() => setColorDnaModalVisible(false)}
        />
      ) : (
        <ColorDnaModal
          visible={colorDnaModalVisible}
          palette={palette}
          onClose={() => setColorDnaModalVisible(false)}
        />
      )}

      {/* `addItemFloating` (plain View, not the TourTarget) owns the
          absolute floating position — it sets BOTH `left` and `right`, so
          if IT were the TourTarget its measured box would be the full
          width strip between those edges, not the pill button's own
          (narrower, centered) bounds. TourTarget now wraps only the
          TouchableOpacity itself, so the spotlight matches the button
          exactly, `radius.pill` corners included. `alignSelf: 'center'`
          on the TourTarget itself is a second, belt-and-suspenders layer
          on top of addItemFloating's own `alignItems: 'center'` — makes
          the shrink-to-content sizing explicit on the TourTarget's own
          style rather than relying only on inherited parent behavior. */}
      <View style={styles.addItemFloating}>
        <FadeInView delay={360}>
          <TourTarget id="scanCta" borderRadius={radius.pill} style={styles.scanCtaTarget}>
            <AnimatedPressable style={styles.addItemTile} onPress={handleScan}>
              <Feather name="plus" size={18} color={colors.inverseText} />
              <Text style={styles.addItemTitle}>{t('closet.hubActions.addItem')}</Text>
            </AnimatedPressable>
          </TourTarget>
        </FadeInView>
      </View>

      <ScanSheet
        visible={scanSheetVisible}
        onClose={() => setScanSheetVisible(false)}
        onSave={addItem}
        palette={palette}
      />

      <Toast key={toastKey} message={toastMessage} holdMs={toastHoldMs} />
      <PaywallModal
        visible={!!paywallMessage}
        message={paywallMessage}
        onClose={closePaywall}
        onUpgrade={() => {
          closePaywall();
          navigation.navigate('Pricing');
        }}
      />
      </Animated.View>
    </ScreenContainer>
  );
}

// Neutral white/glass tile — every Hub tile shares the same plain fill, so
// the one accent color (violet) stands out on the CTA/hero elements around
// it instead of competing with a different hue on every card.
// `tint` ('coral' | 'sky') swaps the tile from the neutral white/glass
// surface to a solid section-accent tint (redesign v3's 2x2 stat grid —
// Style Streak is coral, Capsule Score is sky) and drops the glass shadow
// in favor of the tint's own hairline border; the icon wrap becomes a
// translucent white circle instead of the violet-tinted chip so it still
// reads against the colored tile.
// `statTile` — the Style Streak / Capsule Score pair's own variant: the
// number IS the card (Unbounded, large, top-anchored) with the icon shrunk
// to an inline marker next to its label at the bottom, instead of its own
// circular chip competing with the number for attention. Matches how
// design/moodboard/ref2.jpg and ref4.jpg both put a large number in the
// font's display weight as the card's one visual anchor, not beside a
// decorative icon circle. Every other BentoTile (Planner, Catalog, Shopping
// Copilot) keeps the original icon-chip-then-title layout — that shape
// still fits a real label like "Каталог", it's specifically the stat pair
// with a bare number as `title` that reads better this way.
function BentoTile({ wide, square, statTile, icon, title, subtitle, badge, onPress, tint, dimmed }) {
  function handlePress() {
    triggerHaptic();
    onPress?.();
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      style={[
        styles.bentoTile,
        wide && styles.bentoWide,
        square && styles.bentoSquare,
        tint === 'coral' && styles.bentoTileCoral,
        tint === 'sky' && styles.bentoTileSky,
        dimmed && styles.bentoDimmed,
      ]}
    >
      {badge && <View style={styles.proBadge}>{badge}</View>}
      {statTile ? (
        <>
          <Text style={styles.bentoStatValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {title}
          </Text>
          <View style={styles.bentoStatFooter}>
            {icon}
            <Text style={styles.bentoStatLabel} numberOfLines={1} ellipsizeMode="tail">
              {subtitle}
            </Text>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.bentoIconWrap, tint && styles.bentoIconWrapOnTint]}>{icon}</View>
          <View style={styles.bentoTextWrap}>
            <Text style={styles.bentoTitle} numberOfLines={1} ellipsizeMode="tail">
              {title}
            </Text>
            <Text style={styles.bentoSubtitle} numberOfLines={1} ellipsizeMode="tail">
              {subtitle}
            </Text>
          </View>
        </>
      )}
    </AnimatedPressable>
  );
}

// Top-of-hub Items/Inspirations toggle — the one thing rendered above both
// sections' own content, so it's always reachable regardless of which one
// is showing. Plain local component (not extracted to src/components) since
// nothing else in the app needs a two-state segmented control yet.
// The active pill used to be an instant background swap on tap/swipe-end.
// Now it's a real `Animated.View` whose `translateX` reads straight off the
// pager's own scroll offset (`scrollX`, shared with the ScrollView via
// `Animated.event` in WardrobeScreen) — the pill's position IS the actual
// swipe progress, not a separate animation replaying after the fact. Needs
// its own measured width (`onLayout`) since the pill is sized in real
// pixels, not a CSS percentage transform RN Web doesn't handle reliably.
function SectionSwitcher({ section, onChange, scrollX, screenWidth }) {
  const { t } = useTranslation();
  const [switcherWidth, setSwitcherWidth] = useState(0);
  const thumbWidth = switcherWidth > 0 ? (switcherWidth - 8) / 2 : 0;
  const translateX = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [0, thumbWidth],
    extrapolate: 'clamp',
  });
  // Label color used to flip the instant `section` state changes (React
  // state updates on tap before the thumb has visually caught up) against
  // the thumb's own slow animated slide — for one frame the destination
  // label would go active-white while the thumb (its "background") was
  // still elsewhere, i.e. white text on the plain white switcher. Driving
  // both off the same `scrollX` keeps them mathematically in sync, not
  // just "usually close enough".
  const itemsTextColor = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [colors.inverseText, colors.textSecondary],
    extrapolate: 'clamp',
  });
  const inspirationsTextColor = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [colors.textSecondary, colors.inverseText],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.sectionSwitcher} onLayout={(e) => setSwitcherWidth(e.nativeEvent.layout.width)}>
      {thumbWidth > 0 && (
        <Animated.View
          style={[styles.sectionSwitcherThumb, { width: thumbWidth, transform: [{ translateX }] }]}
        />
      )}
      <TouchableOpacity
        style={styles.sectionSwitcherBtn}
        onPress={() => onChange('items')}
        activeOpacity={0.8}
      >
        <Feather name="grid" size={14} color={section === 'items' ? colors.inverseText : colors.textSecondary} />
        <Animated.Text style={[styles.sectionSwitcherText, { color: itemsTextColor }]}>
          {t('closet.sections.items')}
        </Animated.Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.sectionSwitcherBtn}
        onPress={() => onChange('inspirations')}
        activeOpacity={0.8}
      >
        <Feather
          name="bookmark"
          size={14}
          color={section === 'inspirations' ? colors.inverseText : colors.textSecondary}
        />
        <Animated.Text style={[styles.sectionSwitcherText, { color: inspirationsTextColor }]}>
          {t('closet.sections.inspirations')}
        </Animated.Text>
      </TouchableOpacity>
    </View>
  );
}

// Lookbook grid — saved AI Stylist looks (StylistScreen's Save Inspiration
// button via useWardrobeStore's saveInspiration/inspirations). Named
// "Lookbook*" rather than "Inspiration*" throughout to keep it visually and
// textually distinct in this file from the unrelated "Style Inspiration"
// mood-board strip above (InspirationMiniCard/INSPIRATION_TAGS) — same
// English word, two different features that happen to share a screen.
const LOOKBOOK_SKELETON_COUNT = 4;
const LOOKBOOK_THUMB_LIMIT = 4;
const LOOKBOOK_COLUMNS = 2;

// Groups saved looks into row-sized chunks for the 2-up grid — same
// technique WardrobeCatalogScreen's own `chunkIntoRows` uses for its item
// grid (a local copy per this project's convention, see GeneratedItemThumb's
// own `shadeColor` for another instance of it), rather than a flex-wrap
// container: each row is `flexDirection: 'row'` with real siblings, so a
// lone last-row card can't stretch to fill the row the way a `flex: 1` card
// with no sibling would (see the `lookbookCardSpacer` render below).
function chunkIntoRows(items, columns) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

// The card's own large hero image: the base item's real photo when we have
// one and it's still present in this exact snapshot (a wardrobe item can be
// edited/deleted after the look was saved — the snapshot just won't have an
// entry for it anymore, not a broken reference), else the first generated
// item — a look always has at least one, since the Save button only shows
// once there's something to save.
function getLookbookHero(inspiration) {
  const items = inspiration.generatedItems || [];
  if (inspiration.baseItemId) {
    const match = items.find((entry) => entry.type === 'wardrobe' && entry.id === inspiration.baseItemId);
    if (match) return match;
  }
  return items[0] || null;
}

// Whole card navigates to InspirationDetail (registered on the root Stack —
// see App.js, same pattern WardrobeCatalogScreen's grid card uses for
// ItemDetail). Both `inspirationId` (the param the detail screen actually
// keys its live store lookup off) and the full `inspiration` snapshot ride
// along — the id is authoritative, the snapshot just lets the detail
// screen's first render show something before that lookup resolves, same
// as ItemDetailScreen's own `routeItem` fallback.
//
// The trash button is its own nested TouchableOpacity (stopPropagation via
// simply not bubbling a synthetic RN touch — there's no real DOM bubbling
// to fight here) so a client can delete straight from the grid without
// opening the look first; delete-from-inside-the-detail-screen is the other
// path (see InspirationDetailScreen).
function LookbookCard({ inspiration, onDelete }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { confirm, dialogProps, closeDialog, handleConfirm } = useConfirm();
  const items = inspiration.generatedItems || [];
  const hero = getLookbookHero(inspiration);
  const thumbs = items.filter((entry) => entry !== hero).slice(0, LOOKBOOK_THUMB_LIMIT);
  const overflowCount = items.length - 1 - thumbs.length;

  function handlePress() {
    navigation.navigate('InspirationDetail', { inspirationId: inspiration.id, inspiration });
  }

  function handleDeletePress() {
    confirm({
      title: t('closet.inspirations.deleteTitle'),
      message: t('closet.inspirations.deleteMessage'),
      cancelLabel: t('itemDetail.deleteCancel'),
      confirmLabel: t('itemDetail.deleteConfirm'),
      onConfirm: () => onDelete(inspiration.id),
    });
  }

  return (
    <TouchableOpacity style={styles.lookbookCard} onPress={handlePress} activeOpacity={0.85}>
      <TouchableOpacity
        style={styles.lookbookDeleteBtn}
        onPress={handleDeletePress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.8}
      >
        <Feather name="trash-2" size={13} color="#FFFFFF" />
      </TouchableOpacity>

      {dialogProps && (
        <ConfirmDialog visible onClose={closeDialog} onConfirm={handleConfirm} {...dialogProps} />
      )}

      {hero ? (
        <GeneratedItemThumb uri={hero.imageUrl} name={hero.name} style={styles.lookbookHeroImage} />
      ) : (
        <View style={[styles.lookbookHeroImage, styles.lookbookHeroPlaceholder]}>
          <Feather name="image" size={22} color={colors.textMuted} />
        </View>
      )}

      {thumbs.length > 0 && (
        <View style={styles.lookbookThumbRow}>
          {thumbs.map((entry, index) => (
            <GeneratedItemThumb
              key={index}
              uri={entry.imageUrl}
              name={entry.name}
              style={[styles.lookbookThumb, { borderRadius: 8 }]}
            />
          ))}
          {overflowCount > 0 && (
            <View style={styles.lookbookThumbOverflow}>
              <Text style={styles.lookbookThumbOverflowText}>+{overflowCount}</Text>
            </View>
          )}
        </View>
      )}

      <Text style={styles.lookbookCardCaption} numberOfLines={2}>
        {inspiration.aiText}
      </Text>
    </TouchableOpacity>
  );
}

function LookbookSkeletonCard() {
  return (
    <View style={styles.lookbookCard}>
      <Skeleton style={styles.lookbookHeroImage} borderRadius={radius.lg} />
      <Skeleton width="55%" height={11} style={{ marginTop: spacing.xs }} />
      <Skeleton width="80%" height={11} style={{ marginTop: 4 }} />
    </View>
  );
}

function LookbookSection({ inspirations, loading }) {
  const { t } = useTranslation();
  const removeInspiration = useWardrobeStore((state) => state.removeInspiration);
  const showLoading = loading && inspirations.length === 0;

  if (showLoading) {
    const skeletonRows = chunkIntoRows(Array.from({ length: LOOKBOOK_SKELETON_COUNT }), LOOKBOOK_COLUMNS);
    return (
      <View style={styles.lookbookGrid}>
        {skeletonRows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.lookbookRow}>
            {row.map((_, colIndex) => (
              <LookbookSkeletonCard key={colIndex} />
            ))}
          </View>
        ))}
      </View>
    );
  }

  if (inspirations.length === 0) {
    return (
      <View style={styles.lookbookEmptyCard}>
        <View style={styles.emptyStateIconWrap}>
          <Feather name="bookmark" size={26} color={colors.textMuted} />
        </View>
        <Text style={styles.lookbookEmptyText}>{t('closet.inspirations.empty')}</Text>
      </View>
    );
  }

  const rows = chunkIntoRows(inspirations, LOOKBOOK_COLUMNS);

  return (
    <View style={styles.lookbookGrid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.lookbookRow}>
          {row.map((inspiration) => (
            <LookbookCard key={inspiration.id} inspiration={inspiration} onDelete={removeInspiration} />
          ))}
          {/* Odd item count's last row — without this, the lone card's own
              `flex: 1` (see `lookbookCard`) would stretch it to fill the
              entire row width instead of sitting in its normal half-width
              column, which is exactly the "one photo fills the whole
              screen" bug this whole chunked-row approach exists to rule
              out. Same fix WardrobeCatalogScreen's own grid uses. */}
          {row.length < LOOKBOOK_COLUMNS && <View style={styles.lookbookCardSpacer} />}
        </View>
      ))}
    </View>
  );
}

// Gamification: consecutive days the client planned a look (via Save to
// Planner in the AI Stylist chat). Purely a read of usePlannerStore's
// scheduledOutfits through getStyleStreak() — no separate counter to keep
// in sync. Tapping explains the mechanic rather than navigating anywhere,
// same pattern as the Capsule Score tile above.
function StyleStreakTile({ showToast }) {
  const { t } = useTranslation();
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const streak = useMemo(() => getStyleStreak(scheduledOutfits), [scheduledOutfits]);

  function handlePress() {
    triggerHaptic();
    showToast(t('closet.hub.styleStreak.alertMessage'));
  }

  return (
    <BentoTile
      square
      statTile
      tint="coral"
      icon={<MaterialCommunityIcons name="fire" size={14} color={colors.textPrimary} />}
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
// Completion used to be a manual self-report tap (toggleChallenge, a plain
// dateKey -> true map with no real signal behind it) — a client could mark
// it "done" without doing anything. Now it reads the same real data the
// Style Streak tile already tracks: usePlannerStore's scheduledOutfits keyed
// by date, i.e. "did they actually plan today's outfit". Tapping the card
// always opens Planner (whether done or not) instead of toggling a
// checkbox, since there's no self-report state left to flip.
//
// The done/not-done card, icon-wrap, title and caption colors used to
// cross-fade via Reanimated's `interpolateColor` — diagnostic bisection
// traced the app's native Closet crash to that exact call (interpolating
// toward/between `withAlpha()`-generated `rgba(...)` strings, several of
// them mixed with plain hex, is what was taking Fabric down on real
// devices; the same code never crashed on web, where Reanimated silently
// falls back to JS-thread animation instead of exercising the native
// worklet path at all). Those four colors are now a plain conditional
// (`isDone ? doneColor : color`) — an instant swap instead of an animated
// crossfade, no Reanimated color interpolation anywhere in this component.
// The tap "pop" (scale bounce) stays on Reanimated — it's a pure numeric
// transform with no color work involved, the same shape of animation
// TabNavigator's tab-bar buttons already do safely on every screen.

function DailyChallengeTile() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const skinTone = useUserStore((state) => state.skinTone);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const bodyType = useUserStore((state) => state.bodyType);
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const weather = useWeather();

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const challenge = useMemo(
    () => generateDailyChallenge({ skinTone, hairColor, eyeColor, bodyType }, weather),
    [skinTone, hairColor, eyeColor, bodyType, weather.status, weather.condition, weather.temperature]
  );
  const isDone = Boolean(scheduledOutfits[todayKey]);

  const bounce = useSharedValue(1);
  const animatedBounceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bounce.value }],
  }));

  function handlePress() {
    triggerHaptic();
    bounce.value = withSequence(withTiming(0.98, { duration: 90 }), withTiming(1, { duration: 160 }));
    navigation.navigate('Planner');
  }

  const cardBackground = isDone ? colors.accent : cardTints.violet;
  const iconWrapBackground = isDone ? withAlpha(colors.inverseText, 0.2) : withAlpha(colors.violet, 0.12);
  const titleColor = isDone ? colors.inverseText : colors.textPrimary;
  const captionColor = isDone ? withAlpha(colors.inverseText, 0.8) : colors.textSecondary;

  return (
    <Reanimated.View style={[styles.heroCard, { backgroundColor: cardBackground }, animatedBounceStyle]}>
      <View style={styles.heroBlob} />
      <TouchableOpacity style={styles.heroTouchable} onPress={handlePress} activeOpacity={0.9}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>
            {isDone ? t('closet.hub.dailyChallenge.doneBadge') : t('closet.hub.dailyChallenge.badge')}
          </Text>
        </View>
        <Text style={[styles.heroTitle, { color: titleColor }]} numberOfLines={3}>
          {challenge.title}
        </Text>
        <View style={styles.heroFooterRow}>
          <View style={[styles.heroIconWrap, { backgroundColor: iconWrapBackground }]}>
            <Feather name={isDone ? 'check' : challenge.icon} size={14} color={isDone ? colors.inverseText : colors.violet} />
          </View>
          <Text style={[styles.heroCaption, { color: captionColor }]} numberOfLines={1}>
            {isDone ? t('closet.hub.dailyChallenge.doneSubtitle') : t('closet.hub.dailyChallenge.subtitle')}
          </Text>
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

const styles = StyleSheet.create({
  // ScreenContainer's own `safeArea` style already covers flex:1 + the
  // default background — this only overrides the color for this screen.
  hubContainer: { backgroundColor: colors.premiumBackground },
  // Cancels ScreenContainer's own 16px horizontal padding at the shell
  // level — `hubScroll` below applies that same padding one layer in, on
  // the actual scrollable content, so it isn't doubled to 32px.
  zeroHPadding: { paddingHorizontal: 0 },
  flexFill: { flex: 1 },

  // Wardrobe Hub — Bento dashboard
  hubScroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.screenH,
    // paddingTop set inline above, from real safe-area top inset — not a
    // fixed guess, so it clears the notch/status bar on any device.
    // Extra room at the bottom so the last row can scroll clear of the
    // floating Add Item bar instead of disappearing under it.
    paddingBottom: spacing.xxxl + 64,
  },

  // Vertical stack: Weather, hero challenge, stat row, planner link,
  // catalog/copilot row, color DNA — all spaced by the same 16px gap used
  // horizontally in `bentoRow`, so the grid geometry is even in both
  // directions.
  bentoGrid: {
    gap: spacing.sm,
  },
  // v6 — grid gap tightened to the spec's 12px (was spacing.sm's 16px).
  bentoRow: {
    flexDirection: 'row',
    gap: spacing.gridGap,
  },
  // Lets FadeInView's wrapping Animated.View pass through the `flex: 1` that
  // `bentoSquare` needs to sit side-by-side in a row (see bentoSquare below).
  bentoRowItem: { flex: 1 },

  // Flat white surface (spec: "Surface / glass tile" = `#FFFFFF`) with a
  // soft diffuse shadow instead of a hard border — used by tiles that stay
  // neutral (Catalog, Shopping Copilot, Color DNA). Tinted tiles (`tint`
  // prop on BentoTile) override backgroundColor and drop the shadow.
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
  // v7: fixed 158px height (`statTileBase` in the mockup), not an
  // aspect-ratio square — applies uniformly to the stat row AND the
  // catalog/shopping-copilot row below (`catalogTileStyle` shares the same
  // `statTileBase`).
  bentoSquare: { flex: 1, height: 158 },

  // v7 — icon chip on a white/glass tile is a flat pale-blue fill
  // (`tileIconWrapWhiteStyle`'s literal `#D9E6EE`, same hex as
  // `cardTints.violet`), not an alpha tint of the accent color.
  bentoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: BENTO_RADIUS - 6,
    backgroundColor: cardTints.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Translucent white circle for icon wraps sitting on a tinted (not
  // white/glass) tile — see `BentoTile`'s `tint` prop.
  bentoIconWrapOnTint: {
    backgroundColor: withAlpha(colors.inverseText, 0.6),
  },
  bentoTileCoral: {
    backgroundColor: cardTints.coral,
    borderWidth: 1,
    borderColor: cardTints.coralBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  bentoTileSky: {
    backgroundColor: cardTints.sky,
    borderWidth: 1,
    borderColor: cardTints.skyBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  // Same opacity LockableTile's own `dimmed` style uses on a locked Hub
  // tile — the capsule-score tile has no real unlocked state to switch
  // into regardless of tier (see its own onPress comment), so it stays
  // visually "locked preview" permanently rather than only dimming for
  // free clients.
  bentoDimmed: { opacity: 0.5 },
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
  proBadgeText: { fontFamily: fonts.body, fontSize: 9, fontWeight: '700', color: colors.inverseText, letterSpacing: 0.5 },

  // Shared small section header — matches typography.label styling used
  // elsewhere in the app for section eyebrows.
  sectionLabel: { ...typography.label, marginBottom: spacing.xs },

  // Hero challenge card — full-width, violet-tinted (solid, not glass),
  // with a soft decorative "blob" in the top-right corner. True CSS
  // radial-gradient isn't available in plain RN Views, so the blob is a
  // flat semi-transparent circle — a reasonable simplification of the
  // mockup's radial glow at this fidelity.
  heroCard: {
    borderWidth: 1,
    borderColor: cardTints.violetBorder,
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
    backgroundColor: cardTints.violetBlob,
  },
  heroTouchable: { gap: 10 },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  heroBadgeText: { fontFamily: fonts.body, fontSize: 10.5, fontWeight: '700', color: colors.violet },
  // Unbounded is wider per-glyph than the system font this replaced — the
  // real challenge strings (dailyChallengeEngine.js) run 60-90 characters
  // ("Одевайтесь теплее сегодня — пора доставать самую тёплую верхнюю
  // одежду"), so this dropped fontSize 20->18 and widened maxWidth
  // 72%->80% (still clears the heroBlob decoration in the top-right
  // corner) rather than let a real challenge truncate mid-sentence at 2
  // lines — see the matching numberOfLines bump on the Text itself below.
  heroTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: '800', lineHeight: 23, maxWidth: '80%' },
  heroFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroIconWrap: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  heroCaption: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600' },

  // Now rendered as a fixed sibling above the horizontal swipe pager (see
  // the main return), not inside either page's own ScrollView — needs its
  // own horizontal inset since it's no longer riding on `hubScroll`'s
  // `paddingHorizontal: spacing.screenH`.
  sectionSwitcherWrap: { paddingHorizontal: spacing.screenH, paddingTop: spacing.sm },

  // Items/Inspirations segmented control — see SectionSwitcher.
  sectionSwitcher: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  // Sliding active-pill, positioned behind the two buttons (first child,
  // absolute) — its `translateX` comes from the pager's real scroll offset,
  // not a snap-on-tap swap. Sized/positioned to sit exactly inside the 4px
  // `sectionSwitcher` padding on all sides.
  sectionSwitcherThumb: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.violet,
  },
  sectionSwitcherBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  sectionSwitcherText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.textSecondary },

  // Lookbook grid — see LookbookSection/LookbookCard. Chunked into real rows
  // (chunkIntoRows) rather than one flex-wrap container of percentage-width
  // cards — `lookbookRow` is the actual 2-up flex row; this outer view just
  // stacks those rows.
  lookbookGrid: { gap: spacing.sm },
  lookbookRow: { flexDirection: 'row', gap: spacing.sm },
  // `flex: 1` (not a fixed `width: '47%'`) — inside `lookbookRow`, two of
  // these split the row 50/50 with the row's own `gap` as the only space
  // between them. A lone last-row card would stretch to fill the whole row
  // on its own; `lookbookCardSpacer` (LookbookSection's own render) is the
  // invisible `flex: 1` sibling that keeps it at the same half-width column
  // as every other card instead.
  lookbookCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.xs,
    position: 'relative',
    ...shadows.soft,
  },
  lookbookCardSpacer: { flex: 1 },
  // Floats over the hero image's top-right corner — `zIndex` so it stays
  // above the image on Android (elevation ordering isn't purely paint-order
  // there the way iOS's default z-stacking is).
  lookbookDeleteBtn: {
    position: 'absolute',
    top: spacing.xs + 6,
    right: spacing.xs + 6,
    zIndex: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.45),
  },
  // `aspectRatio: 1` + `resizeMode="cover"` (set on GeneratedItemThumb's own
  // <Image>, not here — a style prop alone can't set that) is the pairing
  // that actually keeps a real photo of arbitrary proportions cropped
  // cleanly to this square instead of stretched/warped to fit it.
  // `radius.lg` (not the card's own `radius.card`) — a large square image
  // reads better with a visibly-but-not-maximally rounded corner; nested
  // inside the card's own 20px radius, this still looks like one
  // consistent shape family rather than two unrelated corner treatments.
  lookbookHeroImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  lookbookHeroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  lookbookThumbRow: { flexDirection: 'row', gap: 4, marginTop: spacing.xs },
  lookbookThumb: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  lookbookThumbOverflow: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.inverseBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookbookThumbOverflowText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', color: colors.inverseText },
  lookbookCardCaption: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Zero-looks state — same glassCard + icon-chip + caption convention as
  // WardrobeCatalogScreen's CategoryEmptyState / PlannerScreen's own
  // plannerEmptyStateCard, so this reads as the same "nothing here yet"
  // language every other tab already uses.
  lookbookEmptyCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyStateIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  lookbookEmptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },

  bentoTextWrap: { marginTop: spacing.sm },
  bentoTitle: { ...typography.title, fontSize: 16 },
  bentoSubtitle: { ...typography.bodySecondary, fontSize: 13, marginTop: 2, fontWeight: '500' },

  // Stat-tile variant (Style Streak / Capsule Score) — see BentoTile's own
  // `statTile` branch. The number is the card's one visual anchor, so it
  // gets the display font at genuine headline size, not the shared 16px
  // `bentoTitle`. `adjustsFontSizeToFit` on the Text itself (not a style)
  // is the safety net for a 3-digit streak count without needing a second
  // font-size tier.
  bentoStatValue: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  bentoStatFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bentoStatLabel: { ...typography.bodySecondary, fontSize: 12, fontWeight: '600' },

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
  dressMeBtnText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: colors.inverseText },
  dressMeBtnDisabled: { opacity: opacity.disabled },

  cityModalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
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
  cityModalCancelBtnText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  cityModalApplyBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cityModalApplyBtnDisabled: { opacity: opacity.disabled },
  cityModalApplyBtnText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.inverseText },

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
    backgroundColor: colors.overlay,
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
  colorDnaSwatchName: { fontFamily: fonts.body, fontSize: 14, color: colors.textPrimary, fontWeight: '500' },

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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    ...shadows.accent,
  },
  // Floats above the ScrollView as a fixed footer, centered like the
  // mockup's "+ Add item" pill (not a full-width bar anymore).
  addItemFloating: {
    position: 'absolute',
    left: spacing.screenH,
    right: spacing.screenH,
    bottom: 20,
    alignItems: 'center',
  },
  scanCtaTarget: { alignSelf: 'center' },
  addItemTitle: { fontFamily: fonts.display, color: colors.inverseText, fontWeight: '800', fontSize: 14.5 },

  errorBox: {
    width: '100%',
    padding: spacing.sm,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    ...shadows.soft,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
