import { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, Platform } from 'react-native';
import { colors, radius, spacing, shadows } from '../theme/tokens';

const SHOW_MS = 220;
const HOLD_MS = 1800;
const HIDE_MS = 200;

// Lightweight, auto-dismissing toast. The platform has no cross-platform
// native toast (ToastAndroid is Android-only, iOS has none) and pulling in
// a dependency for one short confirmation message wasn't worth it — this is
// a small custom banner instead: fades/slides up, holds briefly, fades back
// out on its own, no button or dismiss tap needed.
//
// Pass a new `key` from the caller every time it should (re)appear — this
// component's own effect keys off mount, not off `message` changing, so a
// caller showing the *same* text twice in a row (e.g. tapping the same
// locked tile twice) still restarts the animation instead of silently doing
// nothing the second time.
//
// `holdMs` defaults to HOLD_MS — override it for messages longer than a
// short confirmation (e.g. a 1-2 sentence AI verdict) that need more than
// ~1.8s to actually read before the toast fades out.
export default function Toast({ message, holdMs = HOLD_MS }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!message) return undefined;

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: SHOW_MS, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: SHOW_MS, useNativeDriver: true }),
    ]).start();

    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: HIDE_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 12, duration: HIDE_MS, useNativeDriver: true }),
      ]).start();
    }, holdMs);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!message) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    // 'fixed' on web, not 'absolute' — several screens nest this inside a
    // ScrollView/flex chain that react-native-web doesn't give a hard
    // height boundary (the box grows to fit its scrollable content instead
    // of clipping to the viewport), so 'absolute' resolves `bottom: 100`
    // against that oversized content box and the toast renders far below
    // the visible fold. 'fixed' pins it to the real browser viewport
    // regardless of any ancestor's height/overflow quirks. Native RN's
    // Yoga layout doesn't have this problem — 'absolute' there already
    // resolves against the nearest positioned ancestor's real screen
    // bounds, so it stays the correct choice on iOS/Android.
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 100,
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    ...shadows.navBar,
  },
  toastText: { color: colors.inverseText, fontSize: 13.5, fontWeight: '600', textAlign: 'center' },
});
