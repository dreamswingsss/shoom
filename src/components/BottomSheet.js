import { useEffect, useState } from 'react';
import { Modal, View, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { colors, radius, shadows } from '../theme/tokens';

export const SLIDE_MS = 280;
const BACKDROP_MS = 220;
const SLIDE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

// Generic modal bottom sheet — no @gorhom/bottom-sheet or react-native-
// gesture-handler in this project yet, so this is a plain RN `Modal` +
// Reanimated slide/fade instead, matching the animation vocabulary
// OnboardingScreen already uses (useSharedValue/withTiming/Easing.bezier)
// rather than introducing a new native dependency mid-sprint. No drag-to-
// dismiss gesture — tap the backdrop or the sheet's own close affordance.
//
// `mounted` (local state, distinct from the `visible` prop) is what actually
// drives the native `<Modal>`'s own `visible` — react-native-web's Modal
// (this app always runs as web, see App.js) simply stops rendering its
// children the instant `visible` goes false, which cut the slide-down
// Reanimated withTiming below off before a single frame of it ever painted:
// the sheet didn't slide away, it just vanished. Keeping the Modal actually
// mounted for one more `SLIDE_MS` after `visible` turns false — just long
// enough to let translateY/backdropOpacity finish animating toward closed —
// is what makes the close read as a slide-down instead of a cut. Exported
// `SLIDE_MS` lets a caller that needs to sequence something AFTER this sheet
// visually finishes closing (ScanSheet's guest/calibration interstitials)
// wait exactly that long instead of guessing a duration that could drift out
// of sync with this component's own animation.
export default function BottomSheet({ visible, onClose, children, maxHeight }) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(400);
  const backdropOpacity = useSharedValue(0);
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      backdropOpacity.value = withTiming(1, { duration: BACKDROP_MS });
      translateY.value = withTiming(0, { duration: SLIDE_MS, easing: SLIDE_EASING });
      return undefined;
    }

    backdropOpacity.value = withTiming(0, { duration: BACKDROP_MS });
    translateY.value = withTiming(400, { duration: SLIDE_MS, easing: SLIDE_EASING });
    const timer = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16), maxHeight: maxHeight || '88%' },
            sheetStyle,
          ]}
        >
          <View style={styles.grabber} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.cardLg,
    borderTopRightRadius: radius.cardLg,
    ...shadows.navBar,
    ...Platform.select({ android: { elevation: 16 } }),
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 10,
    marginBottom: 4,
  },
});
