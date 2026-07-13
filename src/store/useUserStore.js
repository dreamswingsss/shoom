import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabaseClient';
import { MAX_STYLE_VIBES } from '../constants/profileOptions';

const EMPTY_MEASUREMENTS = { shoulders: null, chest: null, waist: null, hips: null };

const SIMPLE_PROFILE_FIELDS = [
  'gender',
  'hairColor',
  'eyeColor',
  'skinTone',
  'bodyType',
  'height',
  'weight',
  'stylePreferences',
];

// Which fields actually changed between the committed profile (`state`) and
// an incoming full-profile payload (`data`, e.g. from EditProfileScreen's
// Save). Returns raw field keys — StylistScreen owns turning these into
// human-readable labels for the chat prompt, this is just the data-layer diff.
function diffProfileFields(state, data) {
  const changed = SIMPLE_PROFILE_FIELDS.filter((key) => state[key] !== data[key]);

  const prevM = state.measurements || {};
  const nextM = data.measurements || EMPTY_MEASUREMENTS;
  const measurementsChanged = ['shoulders', 'chest', 'waist', 'hips'].some(
    (key) => prevM[key] !== nextM[key]
  );
  if (measurementsChanged) changed.push('measurements');

  return changed;
}

// Merges a single-field setter's patch with the "stale" bookkeeping,
// accumulating onto any not-yet-confirmed changed-field list instead of
// clobbering it (so editing eye color then height before confirming still
// reports both in the chat prompt).
function withStaleFlag(state, patch, fieldKey) {
  return {
    ...patch,
    isProfileStale: true,
    staleChangedFields: state.staleChangedFields.includes(fieldKey)
      ? state.staleChangedFields
      : [...state.staleChangedFields, fieldKey],
  };
}

// camelCase (client shape) -> snake_case (public.users columns, see
// supabase/migrations/0001_init.sql). One place for this mapping so
// completeOnboarding and updateProfile — the two writers — can never drift
// out of sync with each other on field names.
function toDbProfilePatch(patch) {
  return {
    gender: patch.gender,
    hair_color: patch.hairColor,
    eye_color: patch.eyeColor,
    skin_tone: patch.skinTone,
    body_type: patch.bodyType,
    height_cm: patch.height,
    weight_kg: patch.weight,
    measurements: patch.measurements,
    style_preferences: patch.stylePreferences,
  };
}

function syncProfileToSupabase(userId, patch) {
  return supabase.from('users').update(toDbProfilePatch(patch)).eq('id', userId);
}

export const useUserStore = create(
  persist(
    (set, get) => ({
      user: null,
      isLoggedIn: false,

      gender: null,
      hairColor: null,
      eyeColor: null,
      skinTone: null,
      bodyType: null,
      height: null,
      weight: null,
      measurements: EMPTY_MEASUREMENTS,
      stylePreferences: '',
      styleVibes: [],
      // Mirrors the DB's `users.language` column — the actual app-wide
      // language switch (i18next + the `@app_language` AsyncStorage key
      // that i18nReady restores from on cold start) is owned by
      // src/i18n/index.js's setAppLanguage(), which calls syncLanguage()
      // below to keep this in sync. Not read anywhere for display; it
      // exists so a fresh install/new device can pick up the account's
      // saved language (see useSupabaseAuthSync.js).
      language: null,
      // Mirrors the DB's `users.expo_push_token` column — the last token
      // this store either read from public.users (fetchProfile) or wrote
      // to it (syncPushToken). useSupabaseAuthSync compares a freshly
      // fetched device token against this after every login to decide
      // whether a write is even needed.
      pushToken: null,

      // Set whenever a profile field changes after the initial onboarding.
      // StylistScreen watches this to prompt the client in-chat about
      // whether to factor the update into future styling advice.
      isProfileStale: false,
      staleChangedFields: [],

      // Non-null when the last background write to `public.users` (or the
      // last fetchProfile read) failed. Nothing currently renders this, but
      // without SOME error surface a failed sync would fail silently —
      // AsyncStorage would still show the client's own edit locally while
      // the DB quietly kept the old value.
      profileSyncError: null,

      // Session-only — sets isLoggedIn/user from the Supabase session.
      // Deliberately does NOT touch profile fields (gender, etc.): that's
      // fetchProfile's job. useSupabaseAuthSync always awaits fetchProfile()
      // BEFORE calling this, so isLoggedIn never flips true while the
      // profile still holds the *previous* session's (or no) data — that
      // ordering is what fixes the "always sent to Onboarding after
      // logout -> log back in" bug.
      login: (userData) => set({ user: userData, isLoggedIn: true }),

      logout: () =>
        set({
          user: null,
          isLoggedIn: false,
          gender: null,
          hairColor: null,
          eyeColor: null,
          skinTone: null,
          bodyType: null,
          height: null,
          weight: null,
          measurements: EMPTY_MEASUREMENTS,
          stylePreferences: '',
          styleVibes: [],
          language: null,
          pushToken: null,
          isProfileStale: false,
          staleChangedFields: [],
          profileSyncError: null,
        }),

      // Pulls the client's row from public.users into the store — called by
      // useSupabaseAuthSync on every restored/new session, and safe to call
      // again any time the client needs a fresh read (e.g. after the Delete
      // Account flow's Edge Function... though that deletes the row instead).
      fetchProfile: async (userId) => {
        const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();

        if (error) {
          set({ profileSyncError: error.message });
          return;
        }

        // `data` shouldn't be null when `error` isn't set (`.single()`
        // errors on zero rows) — but a brand-new account is exactly the
        // moment that invariant is least trustworthy (row created by a DB
        // trigger a beat before this read), so this reads through a default
        // empty object rather than assuming the shape.
        const row = data || {};
        set({
          gender: row.gender ?? null,
          hairColor: row.hair_color ?? null,
          eyeColor: row.eye_color ?? null,
          skinTone: row.skin_tone ?? null,
          bodyType: row.body_type ?? null,
          height: row.height_cm ?? null,
          weight: row.weight_kg ?? null,
          measurements: row.measurements || EMPTY_MEASUREMENTS,
          stylePreferences: row.style_preferences || '',
          styleVibes: row.style_vibes || [],
          language: row.language || null,
          pushToken: row.expo_push_token || null,
          profileSyncError: null,
        });
      },

      // The one write path for `users.language` — called by
      // src/i18n/index.js's setAppLanguage() (itself the one place both
      // OnboardingScreen's language step and Profile's LanguagePicker funnel
      // through), so every place the client can change language stays in
      // sync with the DB without each call site needing its own Supabase
      // call. No isProfileStale bookkeeping here — language isn't part of
      // the "styling advice" prompt StylistScreen nudges the client about.
      syncLanguage: (langCode) => {
        set({ language: langCode });

        const userId = get().user?.id;
        if (!userId) return;

        supabase
          .from('users')
          .update({ language: langCode })
          .eq('id', userId)
          .then(({ error }) => {
            if (error) set({ profileSyncError: error.message });
          });
      },

      // The one write path for `users.expo_push_token` — called by
      // useSupabaseAuthSync after registerForPushNotificationsAsync()
      // returns a token that differs from what's already in this store
      // (which itself came from the DB via fetchProfile), so a device that
      // already has the current token saved doesn't re-issue the same
      // UPDATE on every single login.
      syncPushToken: (token) => {
        set({ pushToken: token });

        const userId = get().user?.id;
        if (!userId) return;

        supabase
          .from('users')
          .update({ expo_push_token: token })
          .eq('id', userId)
          .then(({ error }) => {
            if (error) set({ profileSyncError: error.message });
          });
      },

      // Individual setters kept for flexibility (e.g. future "edit profile" flows).
      // Local-only (no Supabase write) — nothing currently calls these outside
      // of the gated completeOnboarding/updateProfile flows below, which own
      // the actual persistence.
      setGender: (gender) => set((state) => withStaleFlag(state, { gender }, 'gender')),
      setHairColor: (hairColor) => set((state) => withStaleFlag(state, { hairColor }, 'hairColor')),
      setEyeColor: (eyeColor) => set((state) => withStaleFlag(state, { eyeColor }, 'eyeColor')),
      setSkinTone: (skinTone) => set((state) => withStaleFlag(state, { skinTone }, 'skinTone')),
      setBodyType: (bodyType) => set((state) => withStaleFlag(state, { bodyType }, 'bodyType')),
      setHeight: (height) => set((state) => withStaleFlag(state, { height }, 'height')),
      setWeight: (weight) => set((state) => withStaleFlag(state, { weight }, 'weight')),
      setMeasurements: (measurements) =>
        set((state) => withStaleFlag(state, { measurements }, 'measurements')),
      setStylePreferences: (stylePreferences) =>
        set((state) => withStaleFlag(state, { stylePreferences }, 'stylePreferences')),

      // Chips commit immediately (no "Save" gate, unlike updateProfile below)
      // — toggling a vibe both updates the list locally and syncs
      // `style_vibes` to Supabase in the background. Silently ignores an
      // attempt to add a 4th vibe past the cap rather than erroring;
      // removing one is always allowed.
      toggleStyleVibe: (vibe) => {
        const state = get();
        const isSelected = state.styleVibes.includes(vibe);
        if (!isSelected && state.styleVibes.length >= MAX_STYLE_VIBES) {
          return;
        }
        const styleVibes = isSelected
          ? state.styleVibes.filter((v) => v !== vibe)
          : [...state.styleVibes, vibe];

        set(withStaleFlag(state, { styleVibes }, 'styleVibes'));

        const userId = state.user?.id;
        if (!userId) return;

        supabase
          .from('users')
          .update({ style_vibes: styleVibes })
          .eq('id', userId)
          .then(({ error }) => {
            if (error) set({ profileSyncError: error.message });
          });
      },

      // Called once, at the end of the Onboarding flow — pushes every
      // collected fit-profile field into local state immediately (so
      // App.js's `needsOnboarding` gate flips the instant this returns,
      // matching OnboardingScreen's fire-and-forget call), then persists the
      // same patch to public.users in the background. Not a "change" to an
      // existing profile (there's no prior chat context to react to yet), so
      // this never touches isProfileStale.
      completeOnboarding: async (data) => {
        const patch = {
          gender: data.gender,
          hairColor: data.hairColor,
          eyeColor: data.eyeColor,
          skinTone: data.skinTone,
          bodyType: data.bodyType,
          height: data.height,
          weight: data.weight,
          measurements: data.measurements || EMPTY_MEASUREMENTS,
          stylePreferences: data.stylePreferences || '',
        };

        set({ ...patch, profileSyncError: null });

        const userId = get().user?.id;
        if (!userId) return;

        const { error } = await syncProfileToSupabase(userId, patch);
        if (error) set({ profileSyncError: error.message });
      },

      // Used by EditProfileScreen — same idea as completeOnboarding (one
      // atomic local update instead of 9 separate `set` calls), but does NOT
      // touch isLoggedIn/user, so it never triggers the onboarding gate.
      // Unlike completeOnboarding, this DOES flag isProfileStale — this is
      // an edit to an already-live profile the AI stylist may have already
      // built advice around. Applies the local (optimistic) update first,
      // then persists the same patch to public.users in the background.
      updateProfile: async (data) => {
        const state = get();
        const changedFields = diffProfileFields(state, data);
        // Merge onto (not replace) any not-yet-confirmed changed-field
        // list — otherwise hitting Save here after a standalone
        // toggleStyleVibe() would silently clear that pending nudge
        // instead of surfacing it alongside whatever changed on this form.
        const staleChangedFields = Array.from(
          new Set([...state.staleChangedFields, ...changedFields])
        );

        const patch = {
          gender: data.gender,
          hairColor: data.hairColor,
          eyeColor: data.eyeColor,
          skinTone: data.skinTone,
          bodyType: data.bodyType,
          height: data.height,
          weight: data.weight,
          measurements: data.measurements || EMPTY_MEASUREMENTS,
          stylePreferences: data.stylePreferences || '',
        };

        set({
          ...patch,
          isProfileStale: state.isProfileStale || changedFields.length > 0,
          staleChangedFields,
          profileSyncError: null,
        });

        const userId = state.user?.id;
        if (!userId) return;

        const { error } = await syncProfileToSupabase(userId, patch);
        if (error) set({ profileSyncError: error.message });
      },

      // Called from the Stylist chat's "Yes, update" button — the client has
      // seen the changed-fields prompt and confirmed. Note there's no
      // separate "pending vs. active" profile copy to swap here: the store
      // already holds live values the instant EditProfileScreen saves (and
      // aiChatEngine already reads live state on every request — see
      // sendChatMessage). Confirming just clears the nudge and lets
      // StylistScreen inject an explicit acknowledgment into the chat
      // history so the AI's *replies* start referencing the update too.
      confirmProfileUpdate: () => set({ isProfileStale: false, staleChangedFields: [] }),

      // "No, cancel" — dismiss the nudge without injecting the chat
      // acknowledgment. The already-saved profile data isn't reverted (the
      // client already committed it via EditProfileScreen's own Save
      // action); this only silences the in-chat callout.
      dismissProfileStale: () => set({ isProfileStale: false, staleChangedFields: [] }),

      // Clears only the fit-profile fields (keeps the Google session intact) so
      // App.js routes the user back into OnboardingScreen to redo the questionnaire.
      // No longer wired to the "Edit Profile" button (see EditProfileScreen) —
      // kept in case a future "start over" flow needs it. Local-only: it does
      // NOT clear public.users, since re-running Onboarding will overwrite it
      // via completeOnboarding anyway.
      resetProfileParams: () =>
        set({
          gender: null,
          hairColor: null,
          eyeColor: null,
          skinTone: null,
          bodyType: null,
          height: null,
          weight: null,
          measurements: EMPTY_MEASUREMENTS,
          stylePreferences: '',
          styleVibes: [],
          isProfileStale: false,
          staleChangedFields: [],
        }),
    }),
    {
      name: 'user-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
