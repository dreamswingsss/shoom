import { Component, useEffect, useState } from 'react';
import { Platform, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import TabNavigator from './src/navigation/TabNavigator';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AppTour from './src/components/AppTour';
import { useUserStore } from './src/store/useUserStore';
import { useSupabaseAuthSync } from './src/hooks/useSupabaseAuthSync';
import { colors } from './src/theme/tokens';
import { i18nReady } from './src/i18n';

const navigationRef = createNavigationContainerRef();

// Root stack above the tab bar — its only job is to let full-screen detail
// views (ItemDetail) push over the tabs with a native header, back gesture,
// and slide transition, none of which the Tab.Navigator itself provides.
const RootStack = createNativeStackNavigator();

function RootNavigator() {
  return (
    <RootStack.Navigator screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <RootStack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
      <RootStack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={{
          headerTitle: '',
          headerStyle: { backgroundColor: colors.premiumBackground },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
        }}
      />
    </RootStack.Navigator>
  );
}

// Root safety net — a white screen is what ANY uncaught render error looks
// like with no boundary in the tree (this is literally how the post-Google-
// sign-in crash in OnboardingScreen presented). Catches whatever the next
// one turns out to be too, instead of relying on every screen individually
// never throwing. Class component because getDerivedStateFromError /
// componentDidCatch have no hook equivalent.
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error (showing fallback instead of a white screen):', error, info);
  }

  handleRetry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.root, styles.loading]}>
          <Text style={styles.errorText}>Something went wrong.</Text>
          <TouchableOpacity onPress={this.handleRetry} style={styles.retryBtn} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // Optional-chained even though this is a flat, always-initialized zustand
  // field (never a nullable `profile` object to destructure) — a brand-new
  // account genuinely has no Fit Profile row yet, and this read must resolve
  // to a falsy value (routing to Onboarding) rather than ever throw.
  const gender = useUserStore((state) => state?.gender);
  // Drives useUserStore's isLoggedIn/user/profile from the real Supabase
  // session (restored session on cold start, or a live sign-in/sign-out)
  // instead of trusting whatever was last persisted to AsyncStorage on its
  // own. Crucially, `sessionReady` only flips true AFTER the hook has
  // awaited fetchProfile() for that session — so by the time the checks
  // below ever run, `gender` (and the rest of the Fit Profile) already
  // reflects the DB, not stale/empty local state. Without that ordering,
  // isLoggedIn could go true one render before gender was populated, and
  // needsOnboarding below would wrongly send an existing user with a
  // complete profile back through Onboarding — the bug this hook fixes.
  const sessionReady = useSupabaseAuthSync();

  const [fontsLoaded] = useFonts({
    // Redesign v2 — Manrope replaces the Space Grotesk/Jakarta pairing for
    // both display and body text (see theme/tokens.js `fonts`). Google
    // ships it as a single variable font; weight is picked via `fontWeight`
    // the same way the old pairing was. `SpaceGrotesk-Variable.ttf` /
    // `PlusJakartaSans-Variable.ttf` are no longer loaded (nothing
    // references those family names anymore) but are still on disk —
    // safe to delete manually, left alone here since removing pre-existing
    // asset files wasn't something this pass was explicitly asked to do.
    Manrope: require('./assets/fonts/Manrope-Variable.ttf'),
    CormorantGaramond: require('./assets/fonts/CormorantGaramond-Variable.ttf'),
  });

  // Gates first render on the saved language (if any) being restored, so
  // the UI never flashes English before switching.
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(() => {
    i18nReady.then(() => setLanguageReady(true));
  }, []);

  // Root routing rule (in priority order):
  //   1. !sessionReady  -> loading screen below
  //   2. !gender        -> OnboardingScreen
  //   3. gender         -> MainTabs
  // `gender` is step 2 of Onboarding (right after language) and is required
  // — every other Fit Profile field can be skipped/left blank — so it's the
  // one reliable "has this client ever finished Onboarding?" signal already
  // used everywhere else in the app (StylistScreen's profile prompt, etc.).
  // Google sign-in itself now lives as OnboardingScreen's LAST step (moved
  // from the old standalone AuthScreen) rather than gating Onboarding —
  // `gender` alone is enough to route both a brand-new install (no session,
  // no profile) and a logged-out client (session cleared, profile cleared
  // by logout()) into OnboardingScreen, with no separate isLoggedIn check
  // needed here.
  const needsOnboarding = !gender;

  if (!fontsLoaded || !languageReady || !sessionReady) {
    return (
      <SafeAreaProvider>
        <View style={[styles.root, styles.loading]}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <View style={styles.root}>
          <View style={styles.shell}>
            {needsOnboarding ? (
              <OnboardingScreen />
            ) : (
              <AppTour navigationRef={navigationRef}>
                <NavigationContainer ref={navigationRef}>
                  <RootNavigator />
                </NavigationContainer>
              </AppTour>
            )}
          </View>
        </View>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // On web — grey background so the shell stands out
    backgroundColor: Platform.OS === 'web' ? '#e5e5e5' : colors.background,
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    justifyContent: 'center',
  },
  loading: { alignItems: 'center' },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 400 : undefined,
    // On web — add a subtle shadow to look like a phone frame
    ...(Platform.OS === 'web' && {
      boxShadow: '0 0 40px rgba(0,0,0,0.18)',
    }),
  },
  errorText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: colors.inverseBackground,
    borderRadius: 100,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryBtnText: {
    color: colors.inverseText,
    fontSize: 15,
    fontWeight: '600',
  },
});
