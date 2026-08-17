import { Fragment, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolateColor } from 'react-native-reanimated';
import WardrobeScreen from '../screens/WardrobeScreen';
import PlannerScreen from '../screens/PlannerScreen';
import StylistScreen from '../screens/StylistScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { TourTarget } from '../components/AppTour';
import { useTelegramBottomSafeArea } from '../hooks/useTelegramSafeArea';
import { colors, spacing, radius, shadows, withAlpha } from '../theme/tokens';

const Tab = createBottomTabNavigator();

// Redesign v10 (Noctis/Marigold) — every tab's active fill is now the SAME
// shared marigold accent, verified directly off the live prototype's
// bottom nav (getComputedStyle on the active "Профиль" pill returned
// `#C98A12` — `colors.marigold` — not a per-tab hue). Replaces v3's
// one-hue-per-tab scheme (violet=Closet, coral=Planner, sky=Stylist,
// sage=Profile), which belonged to the design system this one replaced.
// `labelKey` is resolved through t() inside TabButton (not stored here as a
// literal string) so it re-renders in whichever language is active, and is
// shown next to the icon only once active.
const TAB_CONFIG = {
  Closet: { icon: 'grid', color: colors.marigold, labelKey: 'tabs.closet' },
  Planner: { icon: 'calendar', color: colors.marigold, labelKey: 'tabs.planner' },
  'AI Stylist': { icon: 'zap', color: colors.marigold, labelKey: 'tabs.stylist' },
  Profile: { icon: 'user', color: colors.marigold, labelKey: 'tabs.profile' },
};

const PILL_TRANSITION_MS = 200;

// Which TourTarget id (if any) wraps a given tab's button — read by
// FloatingTabBar below. Closet's App Tour (see WardrobeScreen's
// tourSteps) spotlights AI Stylist ("here's how you get an outfit put
// together for you") and Profile ("set up Color DNA here") as its last two
// steps.
const TOUR_TARGET_BY_TAB = {
  'AI Stylist': 'stylistTab',
  Profile: 'profileTab',
};

// One tab button — a 44x44 transparent circle (icon only) when inactive,
// a filled capsule (icon + label, in the tab's own color) when active.
// Only the background/icon-color crossfades (Reanimated `interpolateColor`,
// same pattern as WardrobeScreen's DailyChallengeTile) — the circle<->pill
// size change itself is instant, matching the mockup's plain CSS
// `transition: background .2s ease` (no width transition specified there).
function TabButton({ route, isFocused, onPress }) {
  const { t } = useTranslation();
  const config = TAB_CONFIG[route.name];
  const progress = useSharedValue(isFocused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isFocused ? 1 : 0, { duration: PILL_TRANSITION_MS });
  }, [isFocused]);

  // Interpolates between two RGBA values of the SAME color (alpha 0 -> 1),
  // not the literal `'transparent'` keyword -> a hex color — on web,
  // Reanimated's interpolateColor has to reconcile 'transparent' (which
  // parses as black, alpha 0) against a completely different hex's own RGB
  // channels, and mid-transition frames can land on genuinely wrong
  // intermediate colors instead of a clean fade. Keeping both ends the same
  // hue removes any channel mismatch to reconcile — only alpha moves.
  const animatedFillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [withAlpha(config.color, 0), config.color]),
  }));

  const iconColor = isFocused ? colors.inverseText : colors.navInactiveIcon;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tabBtn}>
      {/* Plain View owns the shape AND the icon/label children — normal
          React reconciliation (not Reanimated) handles the circle<->pill
          style swap AND the label Text mounting/unmounting together, so
          the browser always recomputes this box's real intrinsic width
          from its actual current children. The color fill lives on a
          SEPARATE `Animated.View` underneath, absolutely positioned to
          just fill whatever box this plain View already resolved — it
          never participates in row/gap/padding layout itself, so
          Reanimated's own web update path (a direct style mutation that
          does NOT reliably force a re-layout when this component's
          CHILDREN change in the same tick) has nothing to get stale about.
          Before this split, the fill and the shape/children lived on the
          SAME Animated.View — active tabs became a correctly-colored, but
          permanently icon-only-width, box: the label Text really was in
          the DOM (confirmed via devtools), just clipped inside a box that
          never grew to fit it. */}
      <View style={isFocused ? styles.pill : styles.circle}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedFillStyle]} />
        <Feather name={config.icon} size={22} color={iconColor} />
        {isFocused && (
          <Text style={styles.tabLabel}>{t(config.labelKey)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Custom floating pill tab bar, replacing React Navigation's default bar.
// Deliberately NOT `position: absolute` — a plain docked (in-flow) element
// with its own outer margin/shadow/rounding reads as "floating" just as
// convincingly, while letting BottomTabView reserve real layout space for
// it automatically. That means every screen's own content simply ends
// where this bar begins (no per-screen "clear the floating bar" padding to
// coordinate), the same way the default tab bar worked before.
function FloatingTabBar({ state, navigation }) {
  // Real device bottom inset (home indicator / gesture-nav bar) instead of a
  // guessed fixed value — this is exactly the clearance React Navigation's
  // default tab bar used to compute for us automatically, before it got
  // replaced with this custom one.
  const insets = useSafeAreaInsets();
  // Telegram's OWN bottom chrome — separate from the device's hardware
  // safe area above, and NOT something `useSafeAreaInsets()` (which only
  // reads the browser's `env(safe-area-inset-*)`) knows anything about. 0
  // outside Telegram, so this is safe to fold into the same `Math.max`
  // unconditionally.
  const telegramBottomInset = useTelegramBottomSafeArea();

  // Raised further off the true bottom edge than a bare safe-area inset
  // alone would put it — a floating pill nav reading as "docked flush to
  // the edge" looks cramped/clipped-adjacent even when nothing is actually
  // clipping it; a visible gap of the screen's own beige background below
  // the pill is what actually makes it read as floating rather than
  // pinned. `36` is the new floor (was 12, then 24) and `28` the fixed
  // lift on top of whichever inset wins (was 14, then 20) — `wrap`'s own
  // `backgroundColor: colors.background` (see its own style below) is what
  // shows through that gap.
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, telegramBottomInset, 36) + 28 }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;

          function onPress() {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          }

          const tabButton = <TabButton route={route} isFocused={isFocused} onPress={onPress} />;

          // Closet's App Tour points two of its later steps at specific
          // tabs (see WardrobeScreen's tourSteps) — wrapping only those
          // routes here, not every one, keeps the other tabs' layout
          // output byte-for-byte identical to before.
          const tourTargetId = TOUR_TARGET_BY_TAB[route.name];
          if (tourTargetId) {
            return (
              <TourTarget id={tourTargetId} key={route.key} borderRadius={radius.pill}>
                {tabButton}
              </TourTarget>
            );
          }

          return <Fragment key={route.key}>{tabButton}</Fragment>;
        })}
      </View>
    </View>
  );
}

export default function TabNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Closet"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Closet" component={WardrobeScreen} />
      <Tab.Screen name="Planner" component={PlannerScreen} />
      <Tab.Screen name="AI Stylist" component={StylistScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 0,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    // paddingBottom set inline above, from real safe-area inset.
    paddingTop: 6,
  },
  bar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.navGap,
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.navBarH,
    paddingVertical: spacing.navBarV,
    ...shadows.navBar,
  },
  // Deliberately NOT `flex: 0` — react-native-web translates that SHORTHAND
  // into literal CSS shorthand semantics (flex-grow:0; flex-shrink:1;
  // flex-basis:0%), which collapsed this button to 0 width with nothing
  // left to protect its content's natural size (confirmed empirically: the
  // TouchableOpacity's own computed width was 0, one level below the
  // 32px-clipped pill). `flexShrink: 0` alone is the LONGHAND that actually
  // matches what RN's Yoga engine already does by default for a plain View
  // with no flex prop at all (flexGrow: 0, flexShrink: 0, flexBasis: auto —
  // size to content) — the same shorthand-vs-Yoga-default mismatch class of
  // bug as ScreenContainer's own flexShrink fix, just biting in the
  // opposite direction here.
  tabBtn: { flexShrink: 0 },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.inverseText,
  },
});
