// Presentational action sheet — the web-compatible counterpart to
// `ActionSheetIOS`/`Alert.alert`. Neither has a real implementation on
// react-native-web (`Alert.alert` is a silent no-op there — see
// ConfirmDialog's own comment for the full story; `ActionSheetIOS` doesn't
// exist on that platform at all), so a "pick one of several actions" menu
// built only on those is actually broken on web, not just untested. Pair
// this with `useActionSheet()` (hooks/useActionSheet.js) rather than
// rendering it directly — that hook decides whether to show this at all
// (native keeps the real OS action sheet/alert) or this component (web
// only).
//
// Same CenteredModal shell ConfirmDialog already uses, but a vertical list
// of full-width option buttons instead of a 2-up confirm/cancel row — an
// action sheet's whole point is offering more than two choices.
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import CenteredModal from './CenteredModal';
import { colors, spacing, radius, typography } from '../theme/tokens';

export default function ActionSheetModal({ visible, onClose, title, options, onSelect }) {
  return (
    <CenteredModal visible={visible} onClose={onClose}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.optionList}>
        {(options || []).map((option, index) => (
          <TouchableOpacity
            key={index}
            // The cancel option gets a little extra breathing room above it
            // (not a different fill) — same "cancel reads as neutral, not
            // destructive" convention ActionSheetIOS/Alert already follow;
            // only `destructive` options get colors.danger text.
            style={[styles.optionBtn, option.cancel && styles.cancelBtn]}
            onPress={() => onSelect(option)}
            activeOpacity={0.8}
          >
            <Text style={[styles.optionText, option.destructive && styles.optionTextDestructive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </CenteredModal>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, textAlign: 'center', marginBottom: spacing.md },
  optionList: { gap: spacing.xs },
  optionBtn: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  cancelBtn: { marginTop: spacing.xs },
  optionText: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  optionTextDestructive: { color: colors.danger },
});
