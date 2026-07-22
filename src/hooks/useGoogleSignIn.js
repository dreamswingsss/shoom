import { useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../services/supabaseClient';
import { useUserStore } from '../store/useUserStore';
import { mapSupabaseUser } from './useSupabaseAuthSync';

// Lets the Google OAuth browser tab/sheet close itself and hand control back
// to the app once the redirect lands — required once, at module scope, by
// expo-auth-session's own docs.
WebBrowser.maybeCompleteAuthSession();

// Google's own OAuth client is never called directly — supabase.auth.
// signInWithOAuth (below) does that server-side, using the Client ID/Secret
// configured in the Supabase dashboard's Google provider. Google only ever
// sees Supabase's fixed HTTPS callback as the redirect_uri (why this works
// in Expo Go: Google refuses an exp:// redirect_uri, so it's never given
// one) — this redirectUri is the SECOND hop, Supabase -> app, governed by
// Supabase's own Redirect URLs allow-list (`exp://**/**`).
const redirectUri = AuthSession.makeRedirectUri();

// Turns the tokens Supabase appended to redirectUri's fragment (after its
// own Google code-exchange finished) into a real session. Mirrors
// Supabase's own React Native/Expo deep-linking example — setSession (not
// exchangeCodeForSession) because signInWithOAuth's default implicit-style
// redirect here returns access_token/refresh_token directly, not a code.
async function createSessionFromUrl(url) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token) return null;

  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return data.user;
}

// Deferred Registration's one Google sign-in flow, shared by every place
// that can now trigger it (ScanSheet's Save-to-Closet gate, ProfileScreen's
// guest CTA) — extracted here specifically so both stay byte-for-byte the
// same process instead of two copies quietly drifting apart.
//
// Handles a subtlety neither call site should have to reimplement: a guest
// reaches either entry point having already picked a `gender` (Onboarding's
// shortened flow) and, since the Smart AI Style Advisor's Тизер →
// Калибровка step, possibly `bodyType`/`hairColor`/`eyeColor`/`skinTone` too
// (TeaserStyleCalibrationSheet's setGuestStyleProfile — see useUserStore.js)
// — all with no session behind any of it yet. fetchProfile below, for a
// genuinely BRAND NEW account, reads back an empty `public.users` row
// (created by the DB's own signup trigger) and would overwrite every one of
// those local picks with null — this snapshots the full set beforehand and
// restores it afterwards in one completeOnboarding call, but ONLY when the
// fetched profile actually came back empty (a RETURNING account's real
// saved values are left alone, not clobbered by whatever a fresh guest
// session happened to have picked this time).
export function useGoogleSignIn() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(null);
  const preAuthProfileRef = useRef(null);

  async function signIn() {
    setError(null);
    setSigningIn(true);
    {
      const state = useUserStore.getState();
      preAuthProfileRef.current = {
        gender: state.gender,
        bodyType: state.bodyType,
        hairColor: state.hairColor,
        eyeColor: state.eyeColor,
        skinTone: state.skinTone,
      };
    }

    try {
      // skipBrowserRedirect: true — this only asks Supabase to build the
      // Google auth URL; it doesn't try to open a browser itself (there's
      // no window to redirect on native), so WebBrowser below owns that.
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUri, skipBrowserRedirect: true },
      });
      if (oauthError) throw oauthError;

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
      if (result.type !== 'success') {
        // Client backed out of Google's account chooser themselves — not an
        // error, just nothing happened.
        return { status: 'cancelled' };
      }

      const authedUser = await createSessionFromUrl(result.url);
      if (!authedUser) return { status: 'cancelled' };

      // Mirrors useSupabaseAuthSync's own syncSession, done explicitly here
      // rather than left to that hook's onAuthStateChange listener (which
      // also fires a moment later and redundantly repeats this, harmlessly)
      // — callers need the store settled synchronously in THIS flow, not
      // whenever that listener happens to get to it.
      await useUserStore.getState().fetchProfile(authedUser.id);
      useUserStore.getState().login(mapSupabaseUser(authedUser));

      // `gender` is the one field every guest is guaranteed to have picked
      // (Onboarding requires it) — a fresh account's empty DB row nulls it
      // out just like the other four, so it's still the reliable "was this
      // fetch actually empty" signal. bodyType/hairColor/eyeColor/skinTone
      // are optional here (a guest may have signed in via ScanSheet's
      // Save-to-Closet gate BEFORE ever seeing the Style Advisor teaser —
      // e.g. she skipped it with "Просто сохранить" — so those four can
      // legitimately still be null even for a fresh account); completeOnboarding
      // itself already treats an omitted field as "leave unset," so passing
      // whatever the snapshot actually captured is safe either way.
      const isFreshAccount = useUserStore.getState().gender == null;
      if (isFreshAccount && preAuthProfileRef.current?.gender) {
        await useUserStore.getState().completeOnboarding(preAuthProfileRef.current);
      }

      return { status: 'success', isFreshAccount };
    } catch (err) {
      // Hard-logged — this is either Supabase's own error (Google provider
      // not enabled/misconfigured in the dashboard, redirectTo not in its
      // Redirect URLs allow-list, …) or Google's (invalid_client,
      // redirect_uri_mismatch on Supabase's OWN callback URL, access_denied,
      // …). Callers decide how to surface `error` themselves (each has its
      // own localized generic-fallback copy).
      console.error('[useGoogleSignIn] Google sign-in failed:', err);
      setError(err);
      return { status: 'error', error: err };
    } finally {
      setSigningIn(false);
    }
  }

  return { signIn, signingIn, error, setError };
}
