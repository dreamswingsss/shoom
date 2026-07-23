import { useCallback, useState } from 'react';

// Shared paywall-modal state — pairs with components/PaywallModal.js the
// same way useConfirm/useToast pair with their own dialog/banner. Every
// free-tier gate (wardrobe limit, chat limit, Shopping Copilot, Capsule
// Score detail, calendar integrations) shows the exact same modal shell,
// just with its own message — this hook is what lets each screen own one
// small bit of state instead of reinventing show/hide bookkeeping per gate.
//
// Usage:
//   const { paywallMessage, showPaywall, closePaywall } = usePaywall();
//   ...
//   showPaywall(t('paywall.wardrobeLimitMessage'));
//   ...
//   <PaywallModal visible={!!paywallMessage} message={paywallMessage} onClose={closePaywall} />
export function usePaywall() {
  const [message, setMessage] = useState(null);

  const showPaywall = useCallback((text) => setMessage(text), []);
  const closePaywall = useCallback(() => setMessage(null), []);

  return { paywallMessage: message, showPaywall, closePaywall };
}
