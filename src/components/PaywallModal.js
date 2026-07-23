// Cross-platform Pro-feature paywall — the one modal every free-tier gate
// (wardrobe limit, chat limit, Shopping Copilot, Capsule Score detail,
// calendar integrations) shows, just with its own `message`. Built on
// CenteredModal (a plain RN `Modal`, not `Alert.alert`), so — unlike
// `Alert.alert`, a silent no-op on react-native-web — this actually renders
// on Web as well as iOS/Android; see CenteredModal's own comment.
//
// `onUpgrade` is a stub for now — there's no real subscription/IAP
// integration yet (see useUserStore's `isPro`, still just a local flag).
// It closes the modal like `onClose` does; wire it to the real purchase
// flow once one exists.
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import CenteredModal from './CenteredModal';
import { colors, spacing, typography, buttons } from '../theme/tokens';

export default function PaywallModal({ visible, message, onClose, onUpgrade }) {
  const { t } = useTranslation();

  return (
    <CenteredModal visible={visible} onClose={onClose}>
      <View style={styles.iconWrap}>
        <Feather name="zap" size={22} color={colors.inverseText} />
      </View>
      <Text style={styles.title}>{t('paywall.title')}</Text>
      <Text style={styles.message}>{message}</Text>

      <TouchableOpacity
        style={styles.upgradeBtn}
        onPress={onUpgrade ?? onClose}
        activeOpacity={0.85}
      >
        <Text style={buttons.primaryText}>{t('paywall.upgrade')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.laterBtn} onPress={onClose} activeOpacity={0.7}>
        <Text style={styles.laterBtnText}>{t('paywall.later')}</Text>
      </TouchableOpacity>
    </CenteredModal>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.title, textAlign: 'center', marginBottom: spacing.xs },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  upgradeBtn: { ...buttons.primary, width: '100%' },
  laterBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, marginTop: 2 },
  laterBtnText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
});
