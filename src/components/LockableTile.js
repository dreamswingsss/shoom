import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, withAlpha } from '../theme/tokens';

// Wraps a Hub tile so it can show as visually present but not yet usable —
// "anticipation design": the client SEES the feature (Planner, Color DNA,
// Shopping Co-pilot, Inspiration) instead of it vanishing from an empty
// closet entirely, but can't open it until `locked` turns false. The
// overlay Pressable sits on top (rendered after, so it's on top in RN's
// z-order) and intercepts the tap before it ever reaches the wrapped
// tile's own onPress — `pointerEvents="none"` on the dimmed content is a
// second line of defense against a stray touch reaching a nested
// touchable underneath.
export default function LockableTile({ locked, onLockedPress, children, style }) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={locked && styles.dimmed} pointerEvents={locked ? 'none' : 'auto'}>
        {children}
      </View>

      {locked && (
        <>
          <View style={styles.lockBadge}>
            <Feather name="lock" size={11} color={colors.inverseText} />
          </View>
          <Pressable style={StyleSheet.absoluteFill} onPress={onLockedPress} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, position: 'relative' },
  dimmed: { opacity: 0.5 },
  lockBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: withAlpha(colors.textPrimary, 0.55),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
