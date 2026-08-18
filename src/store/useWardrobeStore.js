// Wardrobe (public.clothes) store — the single source of truth for the
// client's digital closet, replacing the old `wardrobe` array + related
// actions that used to live on useUserStore (a wardrobe item CRUD concern
// never really belonged on the profile store, and it needs its own async
// loading/error state that useUserStore wasn't designed for). Consumed by
// WardrobeScreen, ItemDetailScreen, StylistScreen, and WeeklyPlanner.
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase } from '../services/supabaseClient';
import { readImageAsBase64 } from '../utils/imageBase64';
import { useUserStore } from './useUserStore';
import { FREE_WARDROBE_LIMIT } from '../constants/monetization';
// Local calendar-day key ("YYYY-MM-DD") — reused rather than reimplemented
// here so the "once per day" rule below and the Planner's own day-keying
// (Style Streak, scheduled outfits) can never drift apart on what "today"
// means. See its own comment in usePlannerStore.js for why this isn't
// `toISOString()` or `toLocaleDateString()`.
import { toDateKey } from './usePlannerStore';

const CLOTHES_BUCKET = 'clothes-photos';
// The Storage upload and the `clothes` insert below are the two network
// calls between "client taps Save" and either a saved item or a caught
// error — on a stalled connection (weak signal mid-scan is the realistic
// case, not a clean rejection) a bare `await` on either can hang
// indefinitely, since neither the fetch client Supabase uses nor the
// supabase-js call itself times out on its own. Racing against a plain
// timer is what turns that into an actual rejection ScanSheet's own
// try/catch can show, instead of a save button stuck spinning forever with
// nothing left for the client to do but force-quit.
const NETWORK_TIMEOUT_MS = 20000;

function toPublicImageUrl(imagePath) {
  return supabase.storage.from(CLOTHES_BUCKET).getPublicUrl(imagePath).data.publicUrl;
}

function withTimeout(promise, message) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), NETWORK_TIMEOUT_MS);
    }),
  ]);
}

// clothes row (snake_case, DB shape) -> wardrobe item (camelCase, the exact
// shape WardrobeScreen/WardrobeCatalogScreen/ItemDetailScreen/aiChatEngine
// already expect) — one place so fetch and insert can never drift apart.
function fromRow(row) {
  return {
    id: row.id,
    imageUri: toPublicImageUrl(row.image_path),
    category: row.category,
    subcategory: row.subcategory,
    color: row.color,
    style: row.style,
    description: row.description,
    wornCount: row.worn_count,
    lastWornDate: row.last_worn_date,
  };
}

const INSPIRATIONS_TABLE = 'inspirations';

// inspirations row (snake_case, DB shape) -> Lookbook entry (camelCase) —
// same one-place-so-fetch-and-insert-never-drift-apart reasoning as
// fromRow above.
function inspirationFromRow(row) {
  return {
    id: row.id,
    baseItemId: row.base_item_id,
    aiText: row.ai_text,
    generatedItems: row.generated_items || [],
    createdAt: row.created_at,
  };
}

export const useWardrobeStore = create((set, get) => ({
  items: [],
  loading: false,
  error: null,

  // Lookbook — saved AI Stylist looks (see StylistScreen's Save
  // Inspiration button). Separate loading flag from `loading` above: the
  // Closet tab's two sections (Items / Inspirations) fetch independently,
  // so switching to Inspirations before Items has resolved (or vice versa)
  // never shows a false "still loading" spinner on the wrong section.
  inspirations: [],
  inspirationsLoading: false,

  // Called from WardrobeScreen's mount effect — Closet is a lazy tab (only
  // mounts on first visit), so fetching there rather than at app boot means
  // this never runs for a session that never opens the tab. `reset()` is
  // called from useSupabaseAuthSync on sign-out instead, so a second
  // account signing in on the same device never briefly sees the first
  // account's closet before this re-fetches.
  //
  // No explicit .eq('user_id', ...) needed — RLS (clothes_select_own in
  // 0001_init.sql) already scopes every row to the signed-in user.
  fetchWardrobe: async () => {
    set({ loading: true, error: null });

    const { data, error } = await supabase
      .from('clothes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({ loading: false, items: data.map(fromRow) });
  },

  // `pendingItem` is exactly WardrobeScreen's scan-confirm shape:
  // { imageUri, category, subcategory, color, style, description }.
  addItem: async (pendingItem) => {
    // Freemium wardrobe cap — WardrobeScreen's own `handleScan` already
    // blocks opening the scanner at all once the free tier is full (the
    // primary UX path, see that screen's own comment), but a client can
    // still reach this far if the sheet was already open when the 30th item
    // landed (e.g. a second device adding items concurrently), so this is
    // the real backstop: no write happens past the cap regardless of how
    // the call got here. Checked against the CURRENT store count, not
    // whatever `handleScan` saw when it opened the sheet.
    // + bonusWardrobeSlots — referral credit (see useUserStore's own
    // comment on that field) raises the effective cap without touching the
    // flat FREE_WARDROBE_LIMIT constant itself.
    const { isPro, bonusWardrobeSlots } = useUserStore.getState();
    if (!isPro && get().items.length >= FREE_WARDROBE_LIMIT + bonusWardrobeSlots) {
      throw new Error(
        'Wardrobe limit reached. Upgrade to Pro to add unlimited items and unlock bulk scanning.'
      );
    }

    // Timed like the upload/insert calls below it — this specific call was
    // the one actually missing that protection. `isLoggedIn` in the store
    // can be stale-true (zustand's `user-storage` persists it with no
    // `partialize`, so it survives past a session that's since gone invalid
    // — e.g. useSupabaseAuthSync's own getSession() failing offline at cold
    // start and silently leaving the old persisted value in place rather
    // than crashing), so a caller that only checked that flag can still
    // reach here with no real session underneath. On a dead connection,
    // `getUser()` itself can validate/refresh against Supabase and never
    // resolve on its own — exactly the "loader hangs forever, guest never
    // sees the sign-in prompt" bug ScanSheet's own guard couldn't fully
    // prevent by itself.
    const {
      data: { user },
    } = await withTimeout(supabase.auth.getUser(), 'Request timed out checking your session.');
    if (!user) throw new Error('Not signed in.');

    const extension = pendingItem.imageUri.split('.').pop()?.split('?')[0] || 'jpg';
    // expo-crypto's named export, not the bare global `crypto` — RN/Hermes
    // doesn't reliably expose Web Crypto's `crypto.randomUUID()` on native
    // the way a browser (this app's web target) does.
    const imagePath = `${user.id}/${Crypto.randomUUID()}.${extension}`;

    // The scanned photo is a local file:// URI at this point (expo-image-
    // picker, pre-compressed to JPEG by ScanSheet's compressImage). fetch()
    // + .blob() looks like the natural way to turn that into upload-able
    // bytes, but React Native's Blob polyfill doesn't reliably carry the
    // full byte payload through to supabase-js's upload() — the request can
    // "succeed" with a truncated/empty object (the photo then renders as a
    // blank white square) or hang until the timeout below fires. Reading
    // the file as base64 and decoding it to a real ArrayBuffer is the
    // byte-for-byte reliable path Supabase's own React Native docs
    // recommend, used here instead.
    const base64Image = await readImageAsBase64(pendingItem.imageUri);

    const { error: uploadError } = await withTimeout(
      supabase.storage.from(CLOTHES_BUCKET).upload(imagePath, decodeBase64(base64Image), { contentType: 'image/jpeg' }),
      'Request timed out uploading the photo.'
    );
    if (uploadError) throw uploadError;

    const { data: row, error: insertError } = await withTimeout(
      supabase
        .from('clothes')
        .insert({
          user_id: user.id,
          image_path: imagePath,
          category: pendingItem.category,
          subcategory: pendingItem.subcategory,
          color: pendingItem.color,
          style: pendingItem.style,
          description: pendingItem.description,
        })
        .select()
        .single(),
      'Request timed out saving the item.'
    );

    if (insertError) {
      // Don't leave an orphaned file in Storage for a row that never landed.
      await supabase.storage.from(CLOTHES_BUCKET).remove([imagePath]);
      throw insertError;
    }

    set((state) => ({ items: [fromRow(row), ...state.items] }));
  },

  // Once per local calendar day per item. Optimistic + rolled back on
  // failure, and the actual guard/increment happens server-side via the
  // increment_worn_count() RPC (0003_worn_today_limit.sql) — two devices
  // tapping "I'm wearing this today" in the same second can't both
  // succeed, and a stale/offline client can't double-count by retrying.
  incrementWornCount: async (itemId) => {
    const today = toDateKey(new Date());
    const previousItems = get().items;
    const item = previousItems.find((i) => i.id === itemId);
    // Mirrors the RPC's own guard client-side, so the common case (already
    // tapped today) short-circuits without a network round-trip at all.
    if (!item || item.lastWornDate === today) return;

    set({
      items: previousItems.map((i) =>
        i.id === itemId ? { ...i, wornCount: i.wornCount + 1, lastWornDate: today } : i
      ),
    });

    const { data: didIncrement, error } = await supabase.rpc('increment_worn_count', {
      item_id: itemId,
      local_date: today,
    });

    if (error) {
      set({ items: previousItems, error: error.message });
      return;
    }

    if (!didIncrement) {
      // Server says another device already logged this item today between
      // our client-side check and this call landing — undo just our
      // optimistic +1 (back to the pre-tap count), but `lastWornDate`
      // really is `today` regardless of who set it, so that part stays.
      set({
        items: get().items.map((i) =>
          i.id === itemId ? { ...i, wornCount: item.wornCount, lastWornDate: today } : i
        ),
      });
    }
  },

  // ItemDetailScreen's inline edit panel (category/color today).
  updateItem: async (itemId, patch) => {
    const previousItems = get().items;
    set({
      items: previousItems.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    });

    const dbPatch = {
      ...(patch.category !== undefined && { category: patch.category }),
      ...(patch.color !== undefined && { color: patch.color }),
    };
    const { error } = await supabase.from('clothes').update(dbPatch).eq('id', itemId);
    if (error) set({ items: previousItems, error: error.message });
  },

  removeItem: async (itemId) => {
    const previousItems = get().items;
    const removedItem = previousItems.find((item) => item.id === itemId);
    set({ items: previousItems.filter((item) => item.id !== itemId) });

    // `clothes` row delete first: RLS still lets the owner delete the
    // Storage object after the row is gone (path ownership, not row
    // existence, gates the storage policy), so order here doesn't strand
    // anything even if the second call fails.
    const { error } = await supabase.from('clothes').delete().eq('id', itemId);
    if (error) {
      set({ items: previousItems, error: error.message });
      return;
    }

    if (removedItem?.imageUri) {
      const imagePath = removedItem.imageUri.split(`${CLOTHES_BUCKET}/`)[1];
      if (imagePath) await supabase.storage.from(CLOTHES_BUCKET).remove([imagePath]);
    }
  },

  // Called from WardrobeScreen's mount effect alongside fetchWardrobe/
  // fetchOutfits — Closet is a lazy TAB (mounted on first visit only), so
  // this still never runs for a session that never opens it; it just
  // doesn't wait for the client to specifically switch to the
  // Inspirations section within an already-open tab.
  fetchInspirations: async () => {
    set({ inspirationsLoading: true, error: null });

    const { data, error } = await supabase
      .from(INSPIRATIONS_TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      set({ inspirationsLoading: false, error: error.message });
      return;
    }

    set({ inspirationsLoading: false, inspirations: data.map(inspirationFromRow) });
  },

  // StylistScreen's Save Inspiration button. `generatedItems` is a
  // self-contained snapshot — every thumbnail the Lookbook card will ever
  // need — built by the caller from whatever mix of real wardrobe items
  // and AI-suggested new pieces that particular look actually had; this
  // store doesn't know or care which. `baseItemId` is null for a look that
  // didn't start from a specific "Style this item" tap. Same timeout
  // reasoning as addItem above: a stalled connection shouldn't leave the
  // button spinning forever with nothing the client can do about it.
  saveInspiration: async ({ baseItemId = null, aiText, generatedItems }) => {
    // See addItem's own comment on why this specific call needs the same
    // timeout the insert below it already has.
    const {
      data: { user },
    } = await withTimeout(supabase.auth.getUser(), 'Request timed out checking your session.');
    if (!user) throw new Error('Not signed in.');

    const { data: row, error } = await withTimeout(
      supabase
        .from(INSPIRATIONS_TABLE)
        .insert({
          user_id: user.id,
          base_item_id: baseItemId,
          ai_text: aiText,
          generated_items: generatedItems,
        })
        .select()
        .single(),
      'Request timed out saving this look.'
    );

    if (error) throw error;

    const inspiration = inspirationFromRow(row);
    set((state) => ({ inspirations: [inspiration, ...state.inspirations] }));
    return inspiration;
  },

  removeInspiration: async (inspirationId) => {
    const previousInspirations = get().inspirations;
    set({ inspirations: previousInspirations.filter((i) => i.id !== inspirationId) });

    const { error } = await supabase.from(INSPIRATIONS_TABLE).delete().eq('id', inspirationId);
    if (error) set({ inspirations: previousInspirations, error: error.message });
  },

  // Called on sign-out / account deletion (see accountService.js) so a
  // second account signing into the same device never sees a flash of the
  // previous user's closet (or Lookbook) before the next fetch resolves.
  reset: () => set({ items: [], loading: false, error: null, inspirations: [], inspirationsLoading: false }),
}));
