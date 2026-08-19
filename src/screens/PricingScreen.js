import { Linking, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { useToast } from '../hooks/useToast';
import { SUPPORT_URL, SUPPORT_TELEGRAM_USERNAME } from '../constants/legal';
import { createPaymentCheckout, openCheckoutUrl } from '../services/paymentService';
import { colors, spacing, radius, shadows, typography, fonts, buttons } from '../theme/tokens';
import ScreenContainer from '../components/ScreenContainer';
import { FadeInView, AnimatedPressable } from '../components/AnimatedPressable';
import Toast from '../components/Toast';

// Real prices live in constants/monetization.js (the one number this file
// must never duplicate as a second literal); tier copy/features are i18n
// text in ru.json's `pricing` namespace since they're display strings, not
// business numbers.
const ALL_TIER_KEYS = ['free', 'proMonthly', 'proYearly', 'founderLifetime'];

export default function PricingScreen() {
  const { t } = useTranslation();
  const isPro = useUserStore((state) => state.isPro);
  const proTier = useUserStore((state) => state.proTier);
  const userId = useUserStore((state) => state.user?.id);
  // Free is a real choice only for a client who doesn't have Pro yet —
  // once any paid tier is active there's nothing to "switch back to" (no
  // downgrade flow exists), so the card just disappears rather than sit
  // there unpickable.
  const tierKeys = isPro ? ALL_TIER_KEYS.filter((key) => key !== 'free') : ALL_TIER_KEYS;
  // Which tier has an outstanding checkout — set right before opening
  // Platega's page, resolved (confirmed/canceled/given-up) by
  // ProActivationWatcher (mounted once at the App.js root, not here — see
  // its own top comment for why polling had to move out of this screen).
  // Only drives that ONE card's own "Проверяем оплату…" label — doesn't
  // block tapping any OTHER tier while it resolves (opening a second
  // checkout just creates a second PENDING row; harmless, and blocking
  // taps here is what used to make every card but the one just tapped read
  // as permanently unresponsive whenever a previous checkout was still
  // being confirmed).
  const pendingTier = useUserStore((state) => state.pendingPayment?.tier ?? null);
  const setPendingPayment = useUserStore((state) => state.setPendingPayment);
  const { toastMessage, toastKey, showToast } = useToast();

  async function handlePress(tierKey) {
    if (tierKey === 'free') return;
    if (isPro && proTier === tierKey) {
      showToast(t('profile.devTogglePro.on', 'Pro уже активен'));
      return;
    }

    if (!userId) {
      Linking.openURL(SUPPORT_URL).catch(() => {
        showToast(t('pricing.ctaComingSoon', { contact: `@${SUPPORT_TELEGRAM_USERNAME}` }));
      });
      return;
    }

    try {
      const { url, transactionId } = await createPaymentCheckout(tierKey);
      setPendingPayment({ tier: tierKey, transactionId });
      await openCheckoutUrl(url);
    } catch (err) {
      console.log('[PricingScreen] checkout failed:', err);
      showToast(t('pricing.paymentErrorToast'));
    }
  }

  return (
    <ScreenContainer edges={['bottom']} contentStyle={styles.content}>
      <Text style={styles.lede}>{t('pricing.lede')}</Text>

      {tierKeys.map((tierKey, index) => (
        <FadeInView key={tierKey} delay={index * 60} style={styles.cardWrap}>
          <TierCard
            tierKey={tierKey}
            isPro={isPro}
            proTier={proTier}
            busy={pendingTier === tierKey}
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

function TierCard({ tierKey, isPro, proTier, busy, onPress }) {
  const { t } = useTranslation();
  const tier = t(`pricing.tiers.${tierKey}`, { returnObjects: true });
  const features = Array.isArray(tier.features) ? tier.features : [];

  const isFounder = tierKey === 'founderLifetime';
  const isYearly = tierKey === 'proYearly';
  // Free reads as "current" only while NOT on Pro; once a specific paid
  // tier is active, ONLY that tier's card should read as current — not
  // every paid tier just because `isPro` is true, and not Free anymore
  // either (that was this screen's actual bug: buying proMonthly used to
  // leave Free's "Текущий тариф" state showing too, and would have shown
  // it on proYearly/founderLifetime as well had the client bought those).
  const isOwned = tierKey === 'free' ? !isPro : proTier === tierKey;
  const ctaLabel = busy
    ? t('pricing.ctaChecking')
    : isOwned
      ? t('pricing.ctaFree')
      : t('pricing.ctaSubscribe');

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={busy}
      style={[styles.card, isFounder && styles.cardFounder, busy && styles.cardDisabled]}
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
          isOwned && isFounder && styles.ctaBtnOwnedOnDark,
        ]}
      >
        <Text
          style={[
            styles.ctaBtnText,
            isFounder && styles.ctaBtnTextOnDark,
            isOwned && styles.ctaBtnTextOwned,
            isOwned && isFounder && styles.ctaBtnTextOwnedOnDark,
          ]}
        >
          {ctaLabel}
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
  // Free/Pro-month/Pro-year all share this plain white card with a solid
  // ink (black) outline — Founder Lifetime is the one visual outlier
  // (dark fill + white outline below), so the other three reading as one
  // consistent family is deliberate, not a missed differentiation.
  card: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.cardLg,
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    padding: spacing.md,
    ...shadows.soft,
  },
  // Founder Lifetime — the one paid tier, so it gets the ink fill (same
  // "solid dark = the one deliberate accent moment" rule the rest of the
  // app already follows for its primary CTAs) instead of another neutral
  // card. White outline instead of black — a black-on-black border would
  // be invisible against this card's own ink fill.
  cardFounder: {
    backgroundColor: colors.inverseBackground,
    borderColor: colors.inverseText,
    borderWidth: 1.5,
  },
  // Only THIS card while ITS OWN checkout/poll is in flight (see `busy`
  // above) — dimmed and unpressable so a second tap can't kick off a
  // second checkout for the same tier. Other cards stay fully tappable;
  // blocking every card whenever any one payment was still resolving used
  // to make every OTHER tier's "Оформить" read as broken.
  cardDisabled: { opacity: 0.5 },

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
  // "Текущий тариф" state — black border/text on the three light cards,
  // flipped to white via ctaBtnOwnedOnDark/ctaBtnTextOwnedOnDark for
  // Founder Lifetime's dark fill (see TierCard's style arrays — the
  // isFounder&&isOwned variants are listed last so they win).
  ctaBtnOwned: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.textPrimary },
  ctaBtnTextOwned: { color: colors.textPrimary },
  ctaBtnOwnedOnDark: { borderColor: colors.inverseText },
  ctaBtnTextOwnedOnDark: { color: colors.inverseText },
});

// Small helper so the founder card's feature text (white-on-dark) doesn't
// need a second literal color duplicating colors.inverseText's own alpha
// convention scattered inline.
function withOnDarkSecondary() {
  return colors.navInactiveIcon;
}
