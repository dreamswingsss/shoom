import { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { useUserStore } from '../store/useUserStore';
import { mapSupabaseUser } from './useSupabaseAuthSync';

// Inside a real Telegram Mini App, window.Telegram.WebApp.initData is a
// short-lived, Telegram-SIGNED query string handed to the page the moment
// it loads — there's no redirect/popup step like the old Login Widget flow
// needed. telegram-verify (a separate, server-side-only call below, the
// only place with the bot token) is what actually checks the signature;
// nothing here is trusted until that call returns.
//
// Plain async function, not a hook — called two ways: automatically from
// useSupabaseAuthSync.js's bootstrap() the moment the Mini App opens with no
// existing Supabase session, AND as a manual retry from RegistrationFlow's
// last step / StylistScreen's Save gate / ProfileScreen's guest CTA if that
// automatic attempt failed (network hiccup, stale initData, or the page was
// opened outside Telegram and initData was never available). Both callers
// get the exact same guest-profile snapshot/restore handling below — a
// device that already has local gender/bodyType/hairColor/eyeColor/skinTone
// picks sitting in AsyncStorage from a previous session (Onboarding, or a
// guest pick made before connectivity dropped) shouldn't lose them just
// because THIS particular sign-in happened to run automatically at
// bootstrap instead of from a button tap.
export async function signInWithTelegram() {
  const preAuthState = useUserStore.getState();
  const preAuthProfile = {
    gender: preAuthState.gender,
    bodyType: preAuthState.bodyType,
    hairColor: preAuthState.hairColor,
    eyeColor: preAuthState.eyeColor,
    skinTone: preAuthState.skinTone,
  };

  try {
    const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : null;
    if (!initData) {
      // Not actually running inside Telegram (e.g. the Vercel URL opened
      // directly in a browser) — nothing to sign in with.
      throw new Error('Telegram Mini App data is not available.');
    }

    const { data: verifyData, error: verifyError } = await supabase.functions.invoke('telegram-verify', {
      body: { initData },
    });
    if (verifyError) throw verifyError;
    if (verifyData?.error) throw new Error(verifyData.error);

    // token_hash is a one-time OTP token, not a session itself — verifyOtp
    // is what actually turns it into real access/refresh tokens.
    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: verifyData.token_hash,
      type: 'magiclink',
    });
    if (otpError) throw otpError;

    const authedUser = otpData.user;
    if (!authedUser) return { status: 'cancelled' };

    await useUserStore.getState().fetchProfile(authedUser.id);
    useUserStore.getState().login(mapSupabaseUser(authedUser));

    // `gender` is the one field every guest is guaranteed to have picked
    // before Deferred Registration reaches its last step — the reliable
    // "was this fetch actually empty" signal for a genuinely brand-new
    // account. At bootstrap time (no prior screen shown yet) this is
    // usually null either way, which is exactly the common case: first-ever
    // open of the Mini App, silent account creation, no profile to restore.
    const isFreshAccount = useUserStore.getState().gender == null;
    if (isFreshAccount && preAuthProfile.gender) {
      await useUserStore.getState().completeOnboarding(preAuthProfile);
    }

    return { status: 'success', isFreshAccount };
  } catch (err) {
    // Hard-logged — this is either telegram-verify's own error (bad
    // signature, expired initData, TELEGRAM_BOT_TOKEN not configured) or
    // Supabase's (verifyOtp failing on a malformed/expired token_hash).
    console.error('[useTelegramSignIn] Telegram sign-in failed:', err);
    return { status: 'error', error: err };
  }
}

// Thin React-state wrapper around signInWithTelegram() for the manual-retry
// call sites (RegistrationFlow/StylistScreen/ProfileScreen) — they need
// signingIn/error as component state to disable a button and show an error
// message, which the bootstrap-time call above doesn't need.
export function useTelegramSignIn() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(null);

  async function signIn() {
    setError(null);
    setSigningIn(true);
    try {
      const result = await signInWithTelegram();
      if (result.status === 'error') setError(result.error);
      return result;
    } finally {
      setSigningIn(false);
    }
  }

  return { signIn, signingIn, error, setError };
}
