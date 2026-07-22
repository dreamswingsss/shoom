import { useEffect } from 'react';
import { Modal, View, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { colors, radius, shadows } from '../theme/tokens';

const SLIDE_MS = 280;
const BACKDROP_MS = 220;
const SLIDE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

// Generic modal bottom sheet — no @gorhom/bottom-sheet or react-native-
// gesture-handler in this project yet, so this is a plain RN `Modal` +
// Reanimated slide/fade instead, matching the animation vocabulary
// OnboardingScreen already uses (useSharedValue/withTiming/Easing.bezier)
// rather than introducing a new native dependency mid-sprint. No drag-to-
// dismiss gesture — tap the backdrop or the sheet's own close affordance.
export default function BottomSheet({ visible, onClose, children, maxHeight }) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(400);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: BACKDROP_MS });
      translateY.value = withTiming(0, { duration: SLIDE_MS, easing: SLIDE_EASING });
    } else {
      backdropOpacity.value = withTiming(0, { duration: BACKDROP_MS });
      translateY.value = withTiming(400, { duration: SLIDE_MS, easing: SLIDE_EASING });
    }
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
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
