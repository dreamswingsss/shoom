import { useEffect, useState } from 'react';

// Telegram's OWN bottom-of-screen chrome (its close/menu bar, or any other
// UI it decides to overlay) isn't part of the device's hardware safe area
// (notch, home indicator) that `react-native-safe-area-context` picks up
// via the browser's `env(safe-area-inset-*)` — Telegram exposes THAT
// overlap separately, as `WebApp.contentSafeAreaInset` (Bot API 8.0+,
// updated via the `contentSafeAreaChanged` event). Without reading it, a
// bottom-docked element sized only off the device's own safe area can still
// end up sitting partly behind Telegram's own chrome — invisible/
// unreachable even though nothing is clipping it anymore.
//
// Returns 0 (never null/undefined) outside Telegram or on an older client
// that predates Bot API 8.0, so callers can add this straight into an
// existing inset calculation with no extra null-checking of their own.
export function useTelegramBottomSafeArea() {
  const [bottom, setBottom] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return undefined;

    function readInset() {
      setBottom(webApp.contentSafeAreaInset?.bottom ?? webApp.safeAreaInset?.bottom ?? 0);
    }

    readInset();
    webApp.onEvent('contentSafeAreaChanged', readInset);
    webApp.onEvent('safeAreaChanged', readInset);
    return () => {
      webApp.offEvent('contentSafeAreaChanged', readInset);
      webApp.offEvent('safeAreaChanged', readInset);
    };
  }, []);

  return bottom;
}
