// Full-screen photo viewer for any tappable image in the app (chat item
// photos today) — plain RN `Modal` + PanResponder + Reanimated, the same
// hand-rolled-overlay approach BottomSheet.js/CenteredModal.js already use
// instead of a new dependency (this project has neither
// react-native-gesture-handler nor a gallery-viewer library installed, and
// PanResponder — core React Native, no extra install — is enough for a
// single swipe-down-to-close gesture). Closes by dragging the image down
// past a threshold OR tapping the close button; a small drag that doesn't
// clear the threshold springs back to center instead of dismissing.
import { useRef } from 'react';
import { Modal, View, Image, TouchableOpacity, PanResponder, Dimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { withAlpha } from '../theme/tokens';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1.2;
const FADE_MS = 200;

export default function FullScreenImageViewer({ visible, imageUri, onClose }) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 6,
      onPanResponderMove: (_evt, gesture) => {
        // Only drags downward move the image — dragging up would suggest
        // there's more content above, which there isn't for a single photo.
        translateY.value = Math.max(0, gesture.dy);
        backdropOpacity.value = 1 - Math.min(1, translateY.value / SCREEN_HEIGHT) * 0.6;
      },
      onPanResponderRelease: (_evt, gesture) => {
        const pastThreshold = gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY;
        if (pastThreshold) {
          translateY.value = withTiming(SCREEN_HEIGHT, { duration: FADE_MS, easing: Easing.in(Easing.cubic) });
          // The completion callback runs as a worklet on the UI thread — it
          // can't call `onClose` (a plain JS/React function) directly, so
          // `handleDismissed` below is wrapped in `runOnJS` to hop back onto
          // the JS thread first.
          backdropOpacity.value = withTiming(0, { duration: FADE_MS }, (finished) => {
            if (finished) runOnJS(handleDismissed)();
          });
        } else {
          translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
          backdropOpacity.value = withTiming(1, { duration: FADE_MS });
        }
      },
    })
  ).current;

  function handleDismissed() {
    translateY.value = 0;
    backdropOpacity.value = 1;
    onClose();
  }

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  if (!imageUri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <View style={styles.root} {...panResponder.panHandlers}>
        <Animated.View style={[styles.imageWrap, imageStyle]}>
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
        </Animated.View>
      </View>

      <TouchableOpacity
        style={[styles.closeBtn, { top: insets.top + 12 }]}
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        activeOpacity={0.8}
      >
        <Feather name="x" size={22} color="#FFFFFF" />
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000' },
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.4),
  },
});
