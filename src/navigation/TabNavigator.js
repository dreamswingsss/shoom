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
import { colors, spacing, radius, shadows } from '../theme/tokens';

const Tab = createBottomTabNavigator();

// Redesign v3 — each tab's active fill is that section's own accent
// (violet=Closet, coral=Planner, sky=Stylist, sage=Profile) instead of one
// shared violet everywhere, so the nav bar previews each section's color
// before you even tap in. `labelKey` is resolved through t() inside
// TabButton (not stored here as a literal string) so it re-renders in
// whichever language is active, and is shown next to the icon only once
// active.
const TAB_CONFIG = {
  Closet: { icon: 'grid', color: colors.violet, labelKey: 'tabs.closet' },
  Planner: { icon: 'calendar', color: colors.coral, labelKey: 'tabs.planner' },
  'AI Stylist': { icon: 'zap', color: colors.sky, labelKey: 'tabs.stylist' },
  Profile: { icon: 'user', color: colors.sage, labelKey: 'tabs.profile' },
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

  const animatedFillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['transparent', config.color]),
  }));

  const iconColor = isFocused ? colors.inverseText : colors.navInactiveIcon;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tabBtn}>
      <Animated.View style={[isFocused ? styles.pill : styles.circle, animatedFillStyle]}>
        <Feather name={config.icon} size={22} color={iconColor} />
        {isFocused && <Text style={styles.tabLabel}>{t(config.labelKey)}</Text>}
      </Animated.View>
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

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) + 14 }]}>
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
  tabBtn: { flex: 0 },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.inverseText,
  },
});
