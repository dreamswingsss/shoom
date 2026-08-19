import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, shadows, typography, buttons } from '../theme/tokens';
import CenteredModal from './CenteredModal';

// "Pro activated" interstitial — same CenteredModal shell + gradient icon
// circle / title / message / pill button shape as ScanSheet's "you need an
// account" prompt (its own authPromptWrap styles), reused here as the
// in-Mini-App equivalent of a system notification: PricingScreen shows
// this the moment its poll sees the payment's status flip to CONFIRMED
// (see pollForResult there), instead of a Toast that's easy to miss.
export default function ProActivatedModal({ visible, onClose, tierLabel }) {
  const { t } = useTranslation();

  return (
    <CenteredModal visible={visible} onClose={onClose}>
      <View style={styles.wrap}>
        <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.iconWrap}>
          <Feather name="check" size={28} color={colors.inverseText} />
        </LinearGradient>
        <Text style={styles.title}>{t('pricing.proActivatedModal.title')}</Text>
        <Text style={styles.message}>
          {t('pricing.proActivatedModal.message', { tier: tierLabel })}
        </Text>

        <TouchableOpacity style={styles.ctaBtn} onPress={onClose} activeOpacity={0.85}>
          <Text style={styles.ctaBtnText}>{t('pricing.proActivatedModal.cta')}</Text>
        </TouchableOpacity>
      </View>
    </CenteredModal>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.cardLg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  title: { ...typography.h2, fontSize: 19, textAlign: 'center', marginBottom: spacing.xs },
  message: {
    ...typography.bodySecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  ctaBtn: {
    width: '100%',
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.accent,
  },
  ctaBtnText: { ...buttons.primaryText, fontSize: 16 },
});
