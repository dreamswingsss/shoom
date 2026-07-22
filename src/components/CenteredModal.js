import { useEffect } from 'react';
import { Modal, View, Pressable, StyleSheet, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { colors, radius, shadows, spacing, withAlpha } from '../theme/tokens';

// Deliberately much more opaque than `colors.overlay` (ink@0.4 — the app's
// usual modal backdrop, meant to let whatever's underneath still read
// through). CenteredModal only has one caller so far (ScanSheet's "you're
// not signed up yet" interstitial) and that caller specifically needs the
// Closet UI behind it to stop competing for attention entirely, not just
// dim — a decision point, not a translucent overlay. No expo-blur dependency
// here (a real blur would need a new native module + rebuild); a
// near-opaque solid tint reads as "glued shut" just as effectively without
// that cost.
const STRONG_BACKDROP = withAlpha(colors.textPrimary, 0.88);

const FADE_MS = 220;
const SCALE_FROM = 0.94;
const SCALE_EASING = Easing.out(Easing.cubic);

// Centered dialog — same plain RN `Modal` + Reanimated fade approach as
// BottomSheet (no @gorhom/bottom-sheet or gesture-handler in this project),
// but anchored to the middle of the screen with a fade+scale entrance
// instead of a slide-up from the bottom. For interstitials that interrupt
// an in-progress action (e.g. ScanSheet's "you need an account" prompt) —
// a sheet sliding up from the bottom of an already-open sheet reads as
// "another layer of the same flow"; a centered card reads as its own
// decision point, which is the distinction ScanSheet needs between "here's
// a form" (BottomSheet) and "you must choose before continuing"
// (CenteredModal). No drag-to-dismiss — tap the backdrop or the content's
// own Cancel affordance.
export default function CenteredModal({ visible, onClose, children, maxWidth = 360 }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(SCALE_FROM);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: FADE_MS });
      scale.value = withTiming(1, { duration: FADE_MS, easing: SCALE_EASING });
    } else {
      opacity.value = withTiming(0, { duration: FADE_MS });
      scale.value = SCALE_FROM;
    }
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View style={[styles.card, { maxWidth }, cardStyle]}>{children}</Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: STRONG_BACKDROP },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.cardLg,
    padding: spacing.lg,
    ...shadows.navBar,
    ...Platform.select({ android: { elevation: 16 } }),
  },
});
