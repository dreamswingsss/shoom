import { View, Text, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius, shadows, withAlpha } from '../theme/tokens';

// Full-screen, untappable overlay covering the whole duration of a
// destructive delete round-trip — a tiny inline spinner (e.g. swapped into
// a button's own label) is too easy to miss entirely, reading as "the tap
// did nothing" right up until the screen suddenly changes underneath the
// client. Shared by ItemDetailScreen (delete an item) and ProfileScreen
// (delete the account) — same visual language both times, `progressText`/
// `doneText` are the only thing that differs per caller.
//
// Swaps the spinner for a checkmark once the delete actually succeeds
// (`done`); the CALLER decides how long to hold that state on screen
// before navigating away or clearing state out from under it — this
// component only renders whatever `visible`/`done` it's handed, it never
// times anything itself.
export default function DeleteStatusOverlay({ visible, done, progressText, doneText }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.card}>
          {done ? (
            <View style={styles.iconWrap}>
              <Feather name="check" size={26} color={colors.inverseText} />
            </View>
          ) : (
            <ActivityIndicator size="large" color={colors.textPrimary} />
          )}
          <Text style={styles.text}>{done ? doneText : progressText}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.textPrimary, 0.4),
  },
  card: {
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 160,
    backgroundColor: colors.surface,
    borderRadius: radius.cardLg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    ...shadows.navBar,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
});
