import { useEffect, useState } from 'react';
import i18n, { setAppLanguage } from '../i18n';
import { supabase } from '../services/supabaseClient';
import { registerForPushNotificationsAsync } from '../utils/notifications';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { usePlannerStore } from '../store/usePlannerStore';

// Supabase's `user.user_metadata` shape depends on the provider — Google's
// OIDC claims land as `full_name`/`avatar_url` (what handle_new_auth_user()
// in 0001_init.sql also reads), with `name`/`picture` as a fallback for
// other providers that use the raw OIDC claim names instead. `id` rides
// along so completeOnboarding/updateProfile/toggleStyleVibe in useUserStore
// know which `public.users` row to write back to.
function mapSupabaseUser(user) {
  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || null,
    email: user.email,
    photo: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
  };
}

// Loads the client's row from `public.users` and applies it to useUserStore
// BEFORE flipping isLoggedIn on — never the other way around. If login()
// ran first, App.js would render one frame with isLoggedIn=true and
// whatever profile fields were left over from before (null on a cold
// start, or the *previous* account's values on a same-session re-login) —
// exactly the "always sent to Onboarding" bug this hook exists to fix, in
// both the cold-start case (Step 2's explicit ask) and the sign-out ->
// sign-back-in-without-restarting case (the client-reported symptom).
async function syncSession(session) {
  const { login, fetchProfile } = useUserStore.getState();
  await fetchProfile(session.user.id);

  // Cross-device language sync: a fresh install (or a device the client
  // never picked a language on) defaults to i18next's `en` fallback —
  // if the account has a different saved language, switch to it now
  // that fetchProfile has it. setAppLanguage() writes back to
  // `users.language` too, but that's a same-value no-op update here
  // since we're only applying what we just read.
  const fetchedLanguage = useUserStore.getState().language;
  if (fetchedLanguage && fetchedLanguage !== i18n.language) {
    await setAppLanguage(fetchedLanguage);
  }

  login(mapSupabaseUser(session.user));

  // Fire-and-forget, deliberately not awaited: registering for push
  // notifications can mean showing the OS permission prompt, and nothing
  // about App.js's loading gate should block on the client answering that
  // — sessionReady flips true (see bootstrap() below) as soon as
  // syncSession's own body finishes, without waiting on this.
  syncPushToken();
}

// Compares a freshly obtained device token against what fetchProfile just
// loaded from public.users, and only writes when they actually differ —
// registerForPushNotificationsAsync() runs (and may re-prompt/re-resolve)
// on every login, but that shouldn't mean a Supabase UPDATE on every login
// too when the device already has the current token saved.
async function syncPushToken() {
  const token = await registerForPushNotificationsAsync();
  if (!token) return;

  const { pushToken, syncPushToken: saveToken } = useUserStore.getState();
  if (token !== pushToken) {
    saveToken(token);
  }
}

// Single source of truth for turning a Supabase auth session into
// useUserStore's isLoggedIn/user/profile — OnboardingScreen's Google
// sign-in (its last step) and ProfileScreen's Log Out button both just ask
// Supabase to change session state (signInWithIdToken / signOut) and let
// this hook react, rather than each call site separately calling
// login()/logout() on the store. That keeps a stale local "isLoggedIn" from
// ever drifting out of sync with whether a Supabase session (and therefore
// RLS access) actually exists.
//
// Returns `sessionReady` — false until the persisted session (if any) has
// been checked AND its profile fetched, so App.js can hold the loading
// screen instead of flashing Onboarding before a restored session's real
// profile data is in the store.
export function useSupabaseAuthSync() {
  const logout = useUserStore((state) => state.logout);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session) await syncSession(session);
      if (!cancelled) setSessionReady(true);
    }

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        // Only a genuine new sign-in needs a fresh profile fetch.
        // `INITIAL_SESSION` (fired once on subscribe, reflecting whatever
        // bootstrap() above is already handling) and `TOKEN_REFRESHED`
        // (same user, same profile) would just be a redundant round-trip.
        if (event === 'SIGNED_IN') {
          syncSession(session);
        }
      } else {
        logout();
        // Wardrobe and Planner are separate stores (their own async
        // loading/error state) — clearing them here too means a second
        // account signing in on the same device never briefly renders the
        // first account's closet/plan before their own mount effects
        // re-fetch.
        useWardrobeStore.getState().reset();
        usePlannerStore.getState().reset();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return sessionReady;
}
