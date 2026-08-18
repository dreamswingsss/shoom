import { Linking, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { useToast } from '../hooks/useToast';
import { SUPPORT_URL, SUPPORT_TELEGRAM_USERNAME } from '../constants/legal';
import { colors, spacing, radius, shadows, typography, fonts, buttons } from '../theme/tokens';
import ScreenContainer from '../components/ScreenContainer';
import { FadeInView, AnimatedPressable } from '../components/AnimatedPressable';
import Toast from '../components/Toast';

// Static tariff content — no live purchase flow yet (the payment provider
// integration is being wired up separately, outside this screen's scope).
// Every CTA here either confirms "you already have this" (Free, or any
// tier once isPro is true) or nudges to support for a manual signup in the
// meantime — see handlePress below. Real prices live in
// constants/monetization.js (the one number this file must never
// duplicate as a second literal); tier copy/features are i18n text in
// ru.json's `pricing` namespace since they're display strings, not
// business numbers.
const TIER_KEYS = ['free', 'proMonthly', 'proYearly', 'founderLifetime'];

export default function PricingScreen() {
  const { t } = useTranslation();
  const isPro = useUserStore((state) => state.isPro);
  const { toastMessage, toastKey, showToast } = useToast();

  function handlePress(tierKey) {
    if (tierKey === 'free') return;
    if (isPro) {
      showToast(t('profile.devTogglePro.on', 'Pro уже активен'));
      return;
    }
    Linking.openURL(SUPPORT_URL).catch(() => {
      showToast(t('pricing.ctaComingSoon', { contact: `@${SUPPORT_TELEGRAM_USERNAME}` }));
    });
  }

  return (
    <ScreenContainer edges={['bottom']} contentStyle={styles.content}>
      <Text style={styles.lede}>{t('pricing.lede')}</Text>

      {TIER_KEYS.map((tierKey, index) => (
        <FadeInView key={tierKey} delay={index * 60} style={styles.cardWrap}>
          <TierCard
            tierKey={tierKey}
            isPro={isPro}
            onPress={() => handlePress(tierKey)}
          />
        </FadeInView>
      ))}

      {/* Temporary payment-provider verification codeword (requested during
          bank approval, same one as public/index.html's meta tag) — placed
          here too so it's visible in the actual rendered app, not just the
          raw HTML a crawler might fetch. Safe to remove once the kassa is
          registered. */}
      <Text style={styles.verificationCode}>PLAT</Text>

      <Toast key={toastKey} message={toastMessage} />
    </ScreenContainer>
  );
}

function TierCard({ tierKey, isPro, onPress }) {
  const { t } = useTranslation();
  const tier = t(`pricing.tiers.${tierKey}`, { returnObjects: true });
  const features = Array.isArray(tier.features) ? tier.features : [];

  const isFounder = tierKey === 'founderLifetime';
  const isYearly = tierKey === 'proYearly';
  const isMonthly = tierKey === 'proMonthly';
  const isOwned = tierKey === 'free' || (isPro && tierKey !== 'free');

  return (
    <AnimatedPressable
      onPress={onPress}
      style={[
        styles.card,
        isMonthly && styles.cardMonthly,
        isYearly && styles.cardYearly,
        isFounder && styles.cardFounder,
      ]}
    >
      {isYearly && (
        <View style={styles.badge}>
          <Feather name="trending-down" size={10} color={colors.inverseText} />
          <Text style={styles.badgeText}>{t('pricing.bestValue')}</Text>
        </View>
      )}

      <Text style={[styles.tierName, isFounder && styles.textOnDark]}>{tier.name}</Text>
      <View style={styles.priceRow}>
        <Text style={[styles.tierPrice, isFounder && styles.textOnDark]}>{tier.price}</Text>
        <Text style={[styles.tierPeriod, isFounder && styles.featureTextOnDark]}>{tier.period}</Text>
      </View>

      <View style={styles.featureList}>
        {features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <Feather name="check" size={14} color={isFounder ? colors.inverseText : colors.violet} />
            <Text style={[styles.featureText, isFounder && styles.featureTextOnDark]}>{feature}</Text>
          </View>
        ))}
      </View>

      <View
        style={[
          styles.ctaBtn,
          isFounder && styles.ctaBtnOnDark,
          isOwned && styles.ctaBtnOwned,
        ]}
      >
        <Text
          style={[
            styles.ctaBtnText,
            isFounder && styles.ctaBtnTextOnDark,
            isOwned && styles.ctaBtnTextOwned,
          ]}
        >
          {isOwned ? t('pricing.ctaFree') : t('pricing.ctaSubscribe')}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxxl },
  verificationCode: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
    letterSpacing: 2,
  },
  lede: { ...typography.bodySecondary, marginBottom: spacing.lg },

  cardWrap: { marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.soft,
  },
  // Four tiers, only two real hues in this palette (ink + marigold — see
  // tokens.js's own v11 comment on why violet/sky/sage all collapse to
  // ink) — so each card is told apart by border weight/color instead of
  // inventing off-palette hues per tier. Free stays the plain neutral
  // `card` border above (nothing to upsell); the paid tiers step up in
  // marigold border weight as the commitment/value goes up.
  cardMonthly: {
    borderColor: colors.marigold,
    borderWidth: 1.5,
  },
  cardYearly: {
    borderColor: colors.marigold,
    borderWidth: 2,
  },
  // Founder Lifetime — the one paid tier, so it gets the ink fill (same
  // "solid dark = the one deliberate accent moment" rule the rest of the
  // app already follows for its primary CTAs) instead of another neutral
  // card, so it reads as the standout option rather than a fourth
  // identical row. Marigold ring on top of the fill keeps it in the same
  // "step up in marigold" family as the other paid tiers rather than
  // looking like an unrelated one-off.
  cardFounder: {
    backgroundColor: colors.inverseBackground,
    borderColor: colors.marigold,
    borderWidth: 2,
  },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.marigold,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  badgeText: { fontFamily: fonts.body, fontSize: 10.5, fontWeight: '700', color: colors.inverseText },

  tierName: { ...typography.rowTitle, marginBottom: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: spacing.sm },
  tierPrice: { fontFamily: fonts.display, fontWeight: '800', fontSize: 26, letterSpacing: -0.4, color: colors.textPrimary },
  tierPeriod: { ...typography.captionSecondary, flexShrink: 1 },
  // Founder Lifetime's dark fill — tierName/tierPrice otherwise inherit
  // colors.textPrimary (near-black), invisible against the same near-black
  // card background. tierPeriod reuses featureTextOnDark below instead of
  // its own third color, same muted-on-dark tone as the feature captions.
  textOnDark: { color: colors.inverseText },

  featureList: { gap: 8, marginBottom: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { ...typography.bodySecondary, fontSize: 13, flex: 1 },
  featureTextOnDark: { color: withOnDarkSecondary() },

  ctaBtn: {
    width: '100%',
    backgroundColor: colors.violet,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnText: { ...buttons.primaryText },
  ctaBtnOnDark: { backgroundColor: colors.surface },
  ctaBtnTextOnDark: { color: colors.textPrimary },
  ctaBtnOwned: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  ctaBtnTextOwned: { color: colors.textMuted },
});

// Small helper so the founder card's feature text (white-on-dark) doesn't
// need a second literal color duplicating colors.inverseText's own alpha
// convention scattered inline.
function withOnDarkSecondary() {
  return colors.navInactiveIcon;
}
