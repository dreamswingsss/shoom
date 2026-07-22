import { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { withAlpha } from '../theme/tokens';

const FADE_WIDTH = 28;
// Small tolerance so float rounding from scroll/layout events doesn't leave
// a fade visibly stuck on at rest (e.g. 0.3px of "scrollable" content).
const EDGE_SLOP = 4;

// Wraps a horizontal ScrollView with left/right edge fades that only show
// while there's actually more content in that direction — unlike a plain
// hard-clipped row, this reads as "you can scroll here" instead of looking
// like an accidental crop, and (unlike a static fade) never lies about
// content existing past an edge that's already fully scrolled to.
// `fadeColor` must match whatever surface the row sits on (colors.background
// / colors.surface) — the gradient fades from that color to transparent, so
// a mismatch would show as a visible seam rather than a blend.
export default function HorizontalFadeScroll({
  children,
  fadeColor,
  style,
  contentContainerStyle,
  ...scrollViewProps
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollX, setScrollX] = useState(0);

  const canScrollLeft = scrollX > EDGE_SLOP;
  const canScrollRight = contentWidth - containerWidth - scrollX > EDGE_SLOP;

  return (
    <View style={[styles.wrap, style]} onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        onContentSizeChange={(width) => setContentWidth(width)}
        onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={32}
        {...scrollViewProps}
      >
        {children}
      </ScrollView>

      {canScrollLeft && (
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(fadeColor, 1), withAlpha(fadeColor, 0)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeLeft]}
        />
      )}
      {canScrollRight && (
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(fadeColor, 0), withAlpha(fadeColor, 1)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeRight]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  fade: { position: 'absolute', top: 0, bottom: 0, width: FADE_WIDTH },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
});
