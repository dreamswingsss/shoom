import { useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { CopilotStep, walkthroughable } from 'react-native-copilot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolateColor } from 'react-native-reanimated';
import WardrobeScreen from '../screens/WardrobeScreen';
import PlannerScreen from '../screens/PlannerScreen';
import StylistScreen from '../screens/StylistScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { colors, spacing, radius, shadows } from '../theme/tokens';

const Tab = createBottomTabNavigator();
const CopilotView = walkthroughable(View);

// Redesign v2 — each tab carries its own accent color instead of one shared
// tint, both for the active pill fill and (implicitly, via cardTints) the
// screen it leads to. `label` is shown next to the icon only once active.
const TAB_CONFIG = {
  Closet: { icon: 'grid', color: colors.violet, label: 'Closet' },
  Planner: { icon: 'calendar', color: colors.coral, label: 'Planner' },
  'AI Stylist': { icon: 'zap', color: colors.sky, label: 'Stylist' },
  Profile: { icon: 'user', color: colors.sage, label: 'Profile' },
};

const PILL_TRANSITION_MS = 200;

// One tab button — a 44x44 transparent circle (icon only) when inactive,
// a filled capsule (icon + label, in the tab's own color) when active.
// Only the background/icon-color crossfades (Reanimated `interpolateColor`,
// same pattern as WardrobeScreen's DailyChallengeTile) — the circle<->pill
// size change itself is instant, matching the mockup's plain CSS
// `transition: background .2s ease` (no width transition specified there).
function TabButton({ route, isFocused, onPress }) {
  const config = TAB_CONFIG[route.name];
  const progress = useSharedValue(isFocused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isFocused ? 1 : 0, { duration: PILL_TRANSITION_MS });
  }, [isFocused]);

  const animatedFillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['transparent', config.color]),
  }));

  const iconColor = isFocused ? colors.inverseText : 'rgba(255,255,255,0.54)';

  const button = (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tabBtn}>
      <Animated.View style={[isFocused ? styles.pill : styles.circle, animatedFillStyle]}>
        <Feather name={config.icon} size={18} color={iconColor} />
        {isFocused && <Text style={styles.tabLabel}>{config.label}</Text>}
      </Animated.View>
    </TouchableOpacity>
  );

  // Guided-tour target — kept exactly as it was on the old default tab bar
  // so AppTour's existing "stylistTab" step still finds this button.
  if (route.name === 'AI Stylist') {
    return (
      <CopilotStep text="Need ideas? Ask your personal AI stylist" order={3} name="stylistTab">
        <CopilotView>{button}</CopilotView>
      </CopilotStep>
    );
  }

  return button;
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

          return <TabButton key={route.key} route={route} isFocused={isFocused} onPress={onPress} />;
        })}
      </View>
    </View>
  );
}

export default function TabNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Profile"
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    ...shadows.md,
    shadowOpacity: 0.28,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
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
