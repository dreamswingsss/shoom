import { useState } from 'react';
import { Linking, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { useToast } from '../hooks/useToast';
import { SUPPORT_URL, SUPPORT_TELEGRAM_USERNAME } from '../constants/legal';
import { createPaymentCheckout, openCheckoutUrl, getPaymentStatus } from '../services/paymentService';
import { colors, spacing, radius, shadows, typography, fonts, buttons } from '../theme/tokens';
import ScreenContainer from '../components/ScreenContainer';
import { FadeInView, AnimatedPressable } from '../components/AnimatedPressable';
import Toast from '../components/Toast';
import ProActivatedModal from '../components/ProActivatedModal';

// Real prices live in constants/monetization.js (the one number this file
// must never duplicate as a second literal); tier copy/features are i18n
// text in ru.json's `pricing` namespace since they're display strings, not
// business numbers.
const TIER_KEYS = ['free', 'proMonthly', 'proYearly', 'founderLifetime'];

// How long (and how often) to poll `payments` for a status after the client
// returns from Platega's checkout page — see handlePress's pollForResult
// below. Platega's own webhook usually lands within a few seconds of a
// confirmed payment; 10x3s = 30s covers that with margin without leaving
// the tier's CTA stuck on "Проверяем оплату…" indefinitely if the client
// just closed the checkout tab without paying.
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PricingScreen() {
  const { t } = useTranslation();
  const isPro = useUserStore((state) => state.isPro);
  const userId = useUserStore((state) => state.user?.id);
  const fetchProfile = useUserStore((state) => state.fetchProfile);
  const { toastMessage, toastKey, showToast } = useToast();
  // Which tier card is mid-flow (checkout open or polling for the result) —
  // at most one at a time, since opening a second checkout while the first
  // is still being confirmed would create two PENDING payments for the
  // same client.
  const [busyTier, setBusyTier] = useState(null);
  // Which tier just got confirmed — drives ProActivatedModal below. This is
  // the in-Mini-App equivalent of a system notification the client asked
  // for (there's no OS notification center to target: the Mini App always
  // runs as Platform.OS === 'web', see App.js's own isTelegramMiniApp
  // comment) — a centered interstitial reliably grabs attention the way a
  // Toast (easy to miss, gone in a couple seconds) doesn't.
  const [activatedTier, setActivatedTier] = useState(null);

  async function pollForResult(tierKey, transactionId) {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      await wait(POLL_INTERVAL_MS);
      let status;
      try {
        status = await getPaymentStatus(transactionId);
      } catch (err) {
        console.log('[PricingScreen] getPaymentStatus failed:', err);
        continue;
      }
      if (status === 'CONFIRMED') {
        if (userId) await fetchProfile(userId);
        setActivatedTier(tierKey);
        return;
      }
      if (status === 'CANCELED') {
        showToast(t('pricing.paymentCanceledToast'));
        return;
      }
    }
    // Still PENDING after every attempt — Platega's webhook may just be
    // slow, or the client backed out without paying. Not treated as an
    // error: the webhook will still credit the account whenever it does
    // land, the next fetchProfile() (e.g. on relaunch) will pick it up.
    showToast(t('pricing.paymentPendingToast'));
  }

  async function handlePress(tierKey) {
    if (tierKey === 'free' || busyTier) return;
    if (isPro) {
      showToast(t('profile.devTogglePro.on', 'Pro уже активен'));
      return;
    }

    if (!userId) {
      Linking.openURL(SUPPORT_URL).catch(() => {
        showToast(t('pricing.ctaComingSoon', { contact: `@${SUPPORT_TELEGRAM_USERNAME}` }));
      });
      return;
    }

    setBusyTier(tierKey);
    try {
      const { url, transactionId } = await createPaymentCheckout(tierKey);
      await openCheckoutUrl(url);
      await pollForResult(tierKey, transactionId);
    } catch (err) {
      console.log('[PricingScreen] checkout failed:', err);
      showToast(t('pricing.paymentErrorToast'));
    } finally {
      setBusyTier(null);
    }
  }

  return (
    <ScreenContainer edges={['bottom']} contentStyle={styles.content}>
      <Text style={styles.lede}>{t('pricing.lede')}</Text>

      {TIER_KEYS.map((tierKey, index) => (
        <FadeInView key={tierKey} delay={index * 60} style={styles.cardWrap}>
          <TierCard
            tierKey={tierKey}
            isPro={isPro}
            busy={busyTier === tierKey}
            disabled={busyTier !== null && busyTier !== tierKey}
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

      <ProActivatedModal
        visible={activatedTier !== null}
        onClose={() => setActivatedTier(null)}
        tierLabel={activatedTier ? t(`pricing.tiers.${activatedTier}.name`) : ''}
      />
    </ScreenContainer>
  );
}

function TierCard({ tierKey, isPro, busy, disabled, onPress }) {
  const { t } = useTranslation();
  const tier = t(`pricing.tiers.${tierKey}`, { returnObjects: true });
  const features = Array.isArray(tier.features) ? tier.features : [];

  const isFounder = tierKey === 'founderLifetime';
  const isYearly = tierKey === 'proYearly';
  const isOwned = tierKey === 'free' || (isPro && tierKey !== 'free');
  const ctaLabel = busy
    ? t('pricing.ctaChecking')
    : isOwned
      ? t('pricing.ctaFree')
      : t('pricing.ctaSubscribe');

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.card, isFounder && styles.cardFounder, disabled && styles.cardDisabled]}
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
  // Every OTHER card while one tier's checkout/poll is in flight (see
  // PricingScreen's `busyTier` state) — dimmed and unpressable so a second
  // tap can't kick off a second concurrent checkout for a different tier.
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
