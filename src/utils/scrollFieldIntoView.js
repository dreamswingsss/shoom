// Shared by every long form with text fields that can end up behind the
// on-screen keyboard on this app's one real target (Telegram Mini App
// WebView, react-native-web) — originally lived only in EditProfileScreen.js,
// pulled out here once ScanSheet's post-scan edit panel and ItemDetailScreen's
// catalog edit panel needed the exact same fix for the exact same symptom.
//
// `event.target` in a React Native Web focus event is the real underlying
// DOM node, so `scrollIntoView` centers the EXACT field that was focused,
// not just some generic scroll position. Native (iOS/Android) event targets
// are opaque handles with no such method, so this silently no-ops there
// instead of needing a Platform.OS check.
//
// Scrolling immediately on focus races the WebView's OWN keyboard-open
// scroll adjustment, which lands slightly later once the keyboard has
// actually finished animating in and silently overrides whatever was just
// scrolled to — the visible symptom is a field that starts smoothly
// centering, then abruptly snaps up and lands jammed under a fixed header,
// or the whole sheet looking like it "jumps." Waiting for `visualViewport`'s
// "resize" event (fires once the keyboard has actually resized the visible
// viewport) before scrolling means this call is the LAST word on scroll
// position, not a step that gets clobbered — so there's exactly one, smooth
// scroll instead of two competing ones. The `setTimeout` is only a safety
// net for a WebView that never fires that resize event at all, so the field
// doesn't stay stuck behind the keyboard forever.
export function scrollFieldIntoView(event) {
  const node = event.target;
  if (typeof node?.scrollIntoView !== 'function') return;

  const doScroll = () => node.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!viewport) {
    doScroll();
    return;
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    viewport.removeEventListener('resize', finish);
    doScroll();
  };
  viewport.addEventListener('resize', finish);
  setTimeout(finish, 400);
}
