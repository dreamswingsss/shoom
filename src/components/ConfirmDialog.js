// Presentational confirm dialog — the web-compatible counterpart to
// `Alert.alert`. React Native's `Alert.alert` has NO implementation on
// react-native-web: calling it there is a silent no-op (no dialog, no
// crash, the confirm/cancel callbacks simply never fire). Since this app
// genuinely ships a web target (app.json's own `web` block, and this
// project is routinely run via `expo start --web`), any screen that only
// confirms destructive actions through `Alert.alert` is actually broken —
// not just "hard to test" — for every web user. Pair this with
// `useConfirm()` (same folder's sibling hook) rather than rendering it
// directly; that hook is what decides whether to show this at all (native
// keeps the real OS Alert — better native UX, zero regression there) or
// this component (web only).
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import CenteredModal from './CenteredModal';
import { colors, spacing, radius, typography } from '../theme/tokens';

export default function ConfirmDialog({
  visible,
  onClose,
  title,
  message,
  cancelLabel,
  confirmLabel,
  destructive = true,
  onConfirm,
}) {
  return (
    <CenteredModal visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, destructive && styles.confirmBtnDanger]}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <Text style={styles.confirmText}>{confirmLabel}</Text>
        </TouchableOpacity>
      </View>
    </CenteredModal>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, textAlign: 'center', marginBottom: spacing.xs },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelText: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  confirmBtn: {
    flex: 1,
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  confirmBtnDanger: { backgroundColor: colors.danger },
  confirmText: { fontSize: 14.5, fontWeight: '700', color: colors.inverseText },
});
