import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors, radius } from '../theme/tokens';

const PULSE_MIN_OPACITY = 0.3;
const PULSE_MAX_OPACITY = 0.7;
const PULSE_DURATION_MS = 700;

// Shimmering placeholder block for wherever real content (a wardrobe card,
// a planner day thumbnail, …) is still loading — swaps a spinner for a
// silhouette shaped like the content that's about to replace it, so the
// layout doesn't jump once real data arrives and the loading state reads
// as "this specific thing is loading" rather than a generic full-screen
// wait.
//
// `width`/`height`/`borderRadius`/`opacity` are applied AFTER `style` in
// the style array (last wins) so a caller's `style` can add spacing
// (margin, alignSelf, …) without accidentally overriding the shimmer
// itself — notably, never pass `backgroundColor` via `style`, it'll be
// clobbered by design.
export default function Skeleton({ width = '100%', height = 16, borderRadius = radius.sm, style }) {
  const opacity = useRef(new Animated.Value(PULSE_MIN_OPACITY)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: PULSE_MAX_OPACITY,
          duration: PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: PULSE_DURATION_MS,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[style, styles.base, { width, height, borderRadius, opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  // Muted grey rather than glassCard (translucent white — meant to sit on
  // the Bento/Stylist screens' tinted premiumBackground canvas) since the
  // screens this is built for (Catalog, Planner) still use the flatter
  // "Quiet Luxury" surface — glassCard would read as nearly invisible
  // against their plain white/cream background.
  base: { backgroundColor: colors.borderStrong },
});
