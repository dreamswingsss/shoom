import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { useToast } from '../hooks/useToast';
import { getPaymentStatus } from '../services/paymentService';
import ProActivatedModal from './ProActivatedModal';
import Toast from './Toast';

// Same window PricingScreen used to poll with itself before this component
// took over the job — see useUserStore's `pendingPayment` comment for why
// that had to move here.
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mounted once at the App.js root (not inside PricingScreen) — resolves
// whatever Platega checkout PricingScreen last opened and shows the "Pro
// activated" celebration wherever the client happens to land, regardless of
// which screen that is. Necessary because returning from Telegram's
// external checkout browser can tear down this Mini App's whole JS session
// (Platform.OS is always 'web' here — see App.js's own isTelegramMiniApp
// comment), silently killing an in-flight poll that PricingScreen itself
// started. `pendingPayment` survives that (it's persisted, unlike
// `isPro`/`proTier`), so this picks the check back up on the very next
// mount instead of leaving a confirmed-but-never-shown purchase.
export default function ProActivationWatcher() {
  const { t } = useTranslation();
  const pendingPayment = useUserStore((state) => state.pendingPayment);
  const userId = useUserStore((state) => state.user?.id);
  const fetchProfile = useUserStore((state) => state.fetchProfile);
  const clearPendingPayment = useUserStore((state) => state.clearPendingPayment);
  const [activatedTier, setActivatedTier] = useState(null);
  const { toastMessage, toastKey, showToast } = useToast();

  useEffect(() => {
    if (!pendingPayment) return undefined;

    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS && !cancelled; attempt++) {
        let status;
        try {
          status = await getPaymentStatus(pendingPayment.transactionId);
        } catch (err) {
          console.log('[ProActivationWatcher] getPaymentStatus failed:', err);
          await wait(POLL_INTERVAL_MS);
          continue;
        }

        if (status === 'CONFIRMED') {
          if (userId) await fetchProfile(userId);
          if (cancelled) return;
          setActivatedTier(pendingPayment.tier);
          clearPendingPayment();
          return;
        }
        if (status === 'CANCELED') {
          if (!cancelled) {
            clearPendingPayment();
            showToast(t('pricing.paymentCanceledToast'));
          }
          return;
        }
        await wait(POLL_INTERVAL_MS);
      }
      // Gave up — see useUserStore's pendingPayment comment: the webhook
      // still credits the account whenever it lands regardless of this
      // poll giving up. This only stops PricingScreen's busy UI (which
      // reads `pendingPayment` too) from being stuck forever.
      if (!cancelled) clearPendingPayment();
    })();

    return () => {
      cancelled = true;
    };
    // clearPendingPayment/fetchProfile/showToast/t are stable references
    // (zustand actions, useToast's useCallback, i18next's per-language t) —
    // deliberately excluded so this only restarts when the actual payment
    // being watched changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPayment, userId]);

  return (
    <>
      <ProActivatedModal
        visible={activatedTier !== null}
        onClose={() => setActivatedTier(null)}
        tierLabel={activatedTier ? t(`pricing.tiers.${activatedTier}.name`) : ''}
      />
      <Toast key={toastKey} message={toastMessage} />
    </>
  );
}
