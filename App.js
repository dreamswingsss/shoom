import { Component, useEffect, useState } from 'react';
import { Platform, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { useTranslation } from 'react-i18next';
import TabNavigator from './src/navigation/TabNavigator';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import InspirationDetailScreen from './src/screens/InspirationDetailScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { AppTourProvider } from './src/components/AppTour';
import { useUserStore } from './src/store/useUserStore';
import { useSupabaseAuthSync } from './src/hooks/useSupabaseAuthSync';
import { colors } from './src/theme/tokens';

const navigationRef = createNavigationContainerRef();

// The "phone frame" web styling below (grey backdrop, centered 400px shell,
// drop shadow) is meant for viewing this app in a genuine WIDE DESKTOP
// browser — react-native-web reports Platform.OS === 'web' for BOTH that
// case AND a Telegram Mini App's WebView, which is really just a normal
// phone-width mobile viewport. Applying the desktop mockup frame there was
// what pushed the whole shell off-center (visible as a dark gap on one edge
// and content clipped on the other in Telegram screenshots) — this flag
// lets the styles below opt back into plain full-width mobile layout
// whenever Telegram's own bridge script (see public/index.html) reports a
// real launch, i.e. window.Telegram.WebApp.initData is non-empty.
const isTelegramMiniApp =
  Platform.OS === 'web' && typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp?.initData);

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
      <RootStack.Screen
        name="InspirationDetail"
        component={InspirationDetailScreen}
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

// Fallback UI shown by AppErrorBoundary below — a plain function component
// so it can use useTranslation(); the class component itself can't (no
// hook equivalent for getDerivedStateFromError/componentDidCatch), so it
// only owns the error-catching lifecycle and delegates rendering here.
function ErrorFallback({ onRetry }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.root, styles.loading]}>
      <Text style={styles.errorText}>{t('errorBoundary.message')}</Text>
      <TouchableOpacity onPress={onRetry} style={styles.retryBtn} activeOpacity={0.8}>
        <Text style={styles.retryBtnText}>{t('errorBoundary.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Root safety net — a white screen is what ANY uncaught render error looks
// like with no boundary in the tree (this is literally how a post-Google-
// sign-in crash used to present, back when this flow lived in
// OnboardingScreen). Catches whatever the next
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
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

export default function App() {
  // Optional-chained even though this is a flat, always-initialized zustand
  // field — defensive consistency with the rest of this component's reads,
  // not because it's ever expected to be missing.
  const hasCompletedWelcome = useUserStore((state) => state?.hasCompletedWelcome);
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

  // Telegram Mini App bootstrap — tells Telegram the page has finished
  // loading (ready()) and asks for the full available viewport height
  // (expand()) instead of the collapsed half-screen a Mini App opens at by
  // default. window.Telegram is only ever defined inside Telegram's own
  // WebView (see public/index.html's telegram-web-app.js script tag) —
  // optional-chained so opening the deployed URL in a normal browser is a
  // silent no-op, not a crash.
  //
  // expand() resizes the WebView asynchronously — a plain CSS `height:100%`
  // chain (html/body/#root, see public/index.html) only catches up with
  // that resize if the WebView actually fires a standard browser `resize`
  // event, which isn't reliable across every Telegram client. Left
  // unhandled, this is exactly what produced the "bottom tab bar and the
  // floating scan button aren't reachable" report: `html`/`body` stayed
  // locked at the pre-expand (collapsed) height, react-native-web's
  // `Dimensions.get('window')` (which every screen-height calculation in
  // this app — including AppTour's spotlight/scroll math — reads from)
  // stayed stale right along with it, and `body`'s own `overflow: hidden`
  // then clipped anything below that stale, too-short height instead of
  // ever making it reachable by scrolling.
  //
  // Fixed by explicitly pinning html/body to Telegram's own reported
  // `viewportStableHeight` (the actual expanded height, once settled) on
  // every `viewportChanged` event, PLUS dispatching a synthetic `resize` so
  // Dimensions (and anything else listening for it) re-reads
  // `window.innerHeight` right away instead of waiting on a native resize
  // event that may never come.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return undefined;

    webApp.ready();
    webApp.expand();

    function syncViewportHeight() {
      const height = webApp.viewportStableHeight || webApp.viewportHeight;
      if (height) {
        document.documentElement.style.height = `${height}px`;
        document.body.style.height = `${height}px`;
      }
      window.dispatchEvent(new Event('resize'));
    }

    syncViewportHeight();
    webApp.onEvent('viewportChanged', syncViewportHeight);
    return () => webApp.offEvent('viewportChanged', syncViewportHeight);
  }, []);

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
    Onest: require('./assets/fonts/Onest-Variable.ttf'),
    'Golos Text': require('./assets/fonts/GolosText-Variable.ttf'),
  });

  // Root routing rule (in priority order):
  //   1. !sessionReady         -> loading screen below
  //   2. !hasCompletedWelcome  -> WelcomeScreen
  //   3. hasCompletedWelcome   -> MainTabs
  // Deferred Registration: neither `isLoggedIn` nor any profile field
  // (`gender` included) is part of this gate. WelcomeScreen's splash is the
  // ONLY thing "Get Started" has to clear — no session, no parameters, just
  // `completeWelcome()` (see useUserStore.js). Every parameter this used to
  // ask up front (gender included) is collected later, inside
  // RegistrationFlow, the first time a guest tries to save a scanned item —
  // gating this on any of THOSE fields would strand a guest on WelcomeScreen
  // forever, since nothing on that screen sets them anymore. Requiring
  // `isLoggedIn` here would have the same failure mode for a different
  // reason: tapping Get Started never creates a session by itself.
  const needsOnboarding = !hasCompletedWelcome;

  if (!fontsLoaded || !sessionReady) {
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
              // WelcomeScreen — just the splash. No parameters collected
              // here at all anymore (gender included — see its own top
              // comment); "Get Started" goes straight to TabNavigator below.
              <WelcomeScreen />
            ) : (
              // Wraps TabNavigator so WardrobeScreen's App Tour (its own
              // "App Tour auto-start" effect) can spotlight the tab bar/CTA
              // the moment a guest lands here right after "Get Started" —
              // that auto-start is what actually shows them around; every
              // profile parameter (gender included) is asked later, inside
              // RegistrationFlow, only once they try to save a scanned item.
              <AppTourProvider>
                <NavigationContainer ref={navigationRef}>
                  <RootNavigator />
                </NavigationContainer>
              </AppTourProvider>
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
    // Desktop-preview-only "phone frame" backdrop — never inside a real
    // Telegram Mini App, which is already phone-width (see
    // isTelegramMiniApp's own comment above).
    backgroundColor: Platform.OS === 'web' && !isTelegramMiniApp ? '#e5e5e5' : colors.background,
    alignItems: Platform.OS === 'web' && !isTelegramMiniApp ? 'center' : 'stretch',
    justifyContent: 'center',
  },
  loading: { alignItems: 'center' },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' && !isTelegramMiniApp ? 400 : undefined,
    // Desktop-preview-only shadow, to look like a phone frame.
    ...(Platform.OS === 'web' && !isTelegramMiniApp && {
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
