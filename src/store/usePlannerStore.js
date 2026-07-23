import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabaseClient';
import { useUserStore } from './useUserStore';
import { FREE_PLANNED_DAYS_LIMIT } from '../constants/monetization';

// Local calendar-day key ("YYYY-MM-DD"). Deliberately not
// `date.toISOString().slice(0, 10)` — that converts to UTC first, which can
// silently roll the date back or forward a day depending on the device's
// timezone offset (e.g. any time after 8pm PST lands on "tomorrow" in UTC).
// Also matches the format Postgres's `date` type round-trips as through
// PostgREST, so it doubles as the `scheduled_date` column value below with
// no extra parsing.
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// outfits row (+ its joined outfit_items) -> the { outfitIds, newItems,
// savedAt } shape every consumer (WeeklyPlanner, StylistScreen,
// WardrobeScreen's StyleStreakTile) already expects — same "one mapping
// function" reasoning as useWardrobeStore's fromRow.
function fromRow(row) {
  return {
    outfitIds: (row.outfit_items || []).map((link) => link.clothes_id),
    newItems: row.new_items || [],
    savedAt: new Date(row.created_at).getTime(),
  };
}

// Persists the weekly outfit plan to `public.outfits` / `public.outfit_items`
// (see supabase/migrations/0001_init.sql) instead of AsyncStorage.
// `completedChallenges` (Daily Challenge gamification) stays local-only —
// it's device/session flavor, not real user data worth a table — so this
// store ends up with a hybrid persistence: `persist` still covers
// `completedChallenges` via its own `partialize`, while `scheduledOutfits`
// is an in-memory cache populated by fetchOutfits(), same pattern as
// useWardrobeStore's `items`.
export const usePlannerStore = create(
  persist(
    (set, get) => ({
      scheduledOutfits: {},
      loading: false,
      error: null,

      // Gamification: dateKey -> true for each day the client marked their
      // Daily Challenge widget done. A plain presence map (like
      // scheduledOutfits) rather than a boolean, so toggling off just
      // deletes the key instead of leaving stale `false` entries around.
      completedChallenges: {},

      // Called from WeeklyPlanner's and WardrobeScreen's mount effects (the
      // Style Streak tile needs this too, and Closet is often opened before
      // Profile in a session) — calling it from both is deliberate
      // redundancy, not a bug: whichever mounts first gets fresh data
      // without the other having to coordinate.
      //
      // Nested select pulls each outfit's linked wardrobe items in one
      // round trip instead of N+1 queries. No explicit `.eq('user_id', ...)`
      // needed — RLS (outfits_select_own in 0001_init.sql) already scopes
      // every row to the signed-in user.
      fetchOutfits: async () => {
        set({ loading: true, error: null });

        const { data, error } = await supabase
          .from('outfits')
          .select('*, outfit_items(clothes_id)')
          .order('scheduled_date', { ascending: true });

        if (error) {
          set({ loading: false, error: error.message });
          return;
        }

        const scheduledOutfits = {};
        data.forEach((row) => {
          scheduledOutfits[row.scheduled_date] = fromRow(row);
        });
        set({ loading: false, scheduledOutfits });
      },

      // Upserts the `outfits` row for this day (one look per day — matches
      // the table's `unique (user_id, scheduled_date)` constraint — saving
      // again for a day that already has a look replaces it, same as the
      // old local-only behavior), then wholesale-replaces its outfit_items
      // links. Replacing rather than diffing old vs. new outfitIds is
      // simpler and just as correct for a handful of rows per outfit.
      scheduleOutfit: async (dateKey, outfit) => {
        // Freemium day-count cap — the real backstop. PlannerScreen's own
        // pre-check (canPlanDay) is the primary UX path, but StylistScreen's
        // Save-to-Planner modal offers every one of the next 7 days with no
        // day-scoped lock of its own, so this is what actually stops a free
        // client from exceeding the cap no matter which screen the request
        // came from. Re-scheduling a day that's ALREADY planned (replacing
        // its look) never counts against the cap — only creating a plan for
        // a day that doesn't have one yet does, per getPlannedDaysCount
        // below counting unique planned dates, not saves.
        if (
          !useUserStore.getState().isPro &&
          !get().scheduledOutfits[dateKey] &&
          getPlannedDaysCount(get().scheduledOutfits) >= FREE_PLANNED_DAYS_LIMIT
        ) {
          throw new Error(
            "You've reached your free limit of 2 planned days. Upgrade to Pro to plan your whole week."
          );
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const outfitIds = outfit.outfitIds || [];
        const newItems = outfit.newItems || [];

        const previous = get().scheduledOutfits;
        set({
          scheduledOutfits: {
            ...previous,
            [dateKey]: { outfitIds, newItems, savedAt: Date.now() },
          },
          error: null,
        });

        const { data: row, error: upsertError } = await supabase
          .from('outfits')
          .upsert(
            { user_id: user.id, scheduled_date: dateKey, new_items: newItems },
            { onConflict: 'user_id,scheduled_date' }
          )
          .select()
          .single();

        if (upsertError) {
          set({ scheduledOutfits: previous, error: upsertError.message });
          return;
        }

        const { error: clearError } = await supabase
          .from('outfit_items')
          .delete()
          .eq('outfit_id', row.id);
        if (clearError) {
          set({ error: clearError.message });
          return;
        }

        if (outfitIds.length > 0) {
          const { error: insertItemsError } = await supabase
            .from('outfit_items')
            .insert(outfitIds.map((clothesId) => ({ outfit_id: row.id, clothes_id: clothesId })));
          if (insertItemsError) set({ error: insertItemsError.message });
        }
      },

      // outfit_items for this day cascade-delete automatically (FK `on
      // delete cascade` on outfit_items.outfit_id, see 0001_init.sql) once
      // the outfits row itself is gone.
      removeOutfit: async (dateKey) => {
        const previous = get().scheduledOutfits;
        const next = { ...previous };
        delete next[dateKey];
        set({ scheduledOutfits: next });

        const { error } = await supabase.from('outfits').delete().eq('scheduled_date', dateKey);
        if (error) set({ scheduledOutfits: previous, error: error.message });
      },

      toggleChallenge: (date) =>
        set((state) => {
          const next = { ...state.completedChallenges };
          if (next[date]) {
            delete next[date];
          } else {
            next[date] = true;
          }
          return { completedChallenges: next };
        }),

      // Called on sign-out (see useSupabaseAuthSync.js) / account deletion
      // (accountService.js) — clears both the Supabase-backed cache and the
      // local gamification state, so a second account signing in on the
      // same device never briefly sees the first account's plan, and never
      // shows "today's challenge done" for a challenge it never completed.
      reset: () => set({ scheduledOutfits: {}, completedChallenges: {}, loading: false, error: null }),
    }),
    {
      name: 'planner-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // `scheduledOutfits`/`loading`/`error` are a Supabase-backed cache,
      // not local source of truth — persisting them would let a stale
      // on-disk copy flash before fetchOutfits() overwrites it. Only
      // `completedChallenges` (genuinely local-only) is worth keeping
      // across app restarts.
      partialize: (state) => ({ completedChallenges: state.completedChallenges }),
    }
  )
);

// Freemium gate's own count — every key in `scheduledOutfits` IS a unique
// planned date already (it's keyed by dateKey, one row per day), so this is
// just naming that fact for the call sites that need it (PlannerScreen's own
// pre-check, scheduleOutfit's real backstop above) rather than each of them
// reaching for `Object.keys(...).length` directly. Same plain-function-over-
// scheduledOutfits shape as getStyleStreak below, not a Zustand-bound
// selector — both are pure derivations any caller can run against a
// snapshot they already have.
export function getPlannedDaysCount(scheduledOutfits) {
  return Object.keys(scheduledOutfits).length;
}

// "Style Streak" — consecutive days (ending today) the client planned a
// look via scheduleOutfit. Today gets a grace period: an unplanned "today"
// doesn't zero the streak by itself (the client just hasn't opened the app
// yet), it only breaks once a full day is skipped entirely.
export function getStyleStreak(scheduledOutfits) {
  const cursor = new Date();
  let streak = 0;

  if (!scheduledOutfits[toDateKey(cursor)]) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (scheduledOutfits[toDateKey(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
