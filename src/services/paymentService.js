// Client side of the Platega checkout flow — pairs with
// supabase/functions/create-payment (creates the checkout link) and
// supabase/functions/platega-webhook (flips users.is_pro once Platega
// confirms the payment; this file never writes is_pro itself). See
// src/screens/PricingScreen.js for the one call site.
import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabaseClient';
import { extractFunctionErrorMessage } from './accountService';

// Same "fresh session, explicit Authorization header" reasoning as
// accountService.js's deleteAccount() — removes any dependency on
// supabase-js's own (reactive-only) Functions-client header sync having
// already run by the time this fires.
export async function createPaymentCheckout(tier) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No active session — please sign in again before subscribing.');
  }

  const { data, error } = await supabase.functions.invoke('create-payment', {
    body: { tier },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    const detail = await extractFunctionErrorMessage(error);
    throw new Error(detail);
  }
  if (!data?.url || !data?.transactionId) {
    throw new Error('Platega response missing url/transactionId.');
  }
  return data;
}

// Platform-aware "go pay" — three real runtime shapes this app ships as
// (see App.js's own isTelegramMiniApp comment): inside Telegram's WebView,
// a plain desktop/mobile browser preview, or the native Android/iOS app.
// Telegram's in-app browser refuses to navigate the WebView itself to an
// external payment host, so a Mini App MUST hand off via
// `Telegram.WebApp.openLink` instead of a normal navigation/window.open.
export async function openCheckoutUrl(url) {
  if (Platform.OS === 'web') {
    const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    if (webApp?.openLink) {
      webApp.openLink(url);
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
      return;
    }
    await Linking.openURL(url);
    return;
  }

  // Native — an in-app browser tab (SFSafariViewController / Custom Tabs)
  // rather than kicking out to the system browser app, and its returned
  // promise resolves the moment the client dismisses it, which is what
  // PricingScreen uses as the cue to re-check payment status.
  await WebBrowser.openBrowserAsync(url);
}

// Polled by PricingScreen after the client returns from checkout — reads
// through `payments_select_own` (0013_payments.sql), never the provider
// directly, since platega-webhook (not this app) is what learns the real
// status first.
export async function getPaymentStatus(transactionId) {
  const { data, error } = await supabase
    .from('payments')
    .select('status')
    .eq('platega_transaction_id', transactionId)
    .maybeSingle();
  if (error) throw error;
  return data?.status ?? null;
}
