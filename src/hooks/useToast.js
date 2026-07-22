import { useCallback, useState } from 'react';

// Shared toast-state bookkeeping — pairs with components/Toast.js, which
// needs a fresh `key` on every call to replay its show/hold/hide animation
// even when the same message fires twice in a row (see that component's own
// comment on why keying off `message` alone isn't enough). Centralizes that
// so screens don't each reinvent the same two-piece-of-state dance.
//
// Usage:
//   const { toastMessage, toastKey, toastHoldMs, showToast } = useToast();
//   ...
//   showToast(t('some.message'));               // default hold
//   showToast(longerText, 3200);                // override, e.g. an AI verdict
//   ...
//   <Toast key={toastKey} message={toastMessage} holdMs={toastHoldMs} />
export function useToast() {
  const [message, setMessage] = useState(null);
  const [key, setKey] = useState(0);
  const [holdMs, setHoldMs] = useState(undefined);

  const showToast = useCallback((text, customHoldMs) => {
    setMessage(text);
    setHoldMs(customHoldMs);
    setKey((k) => k + 1);
  }, []);

  return { toastMessage: message, toastKey: key, toastHoldMs: holdMs, showToast };
}
