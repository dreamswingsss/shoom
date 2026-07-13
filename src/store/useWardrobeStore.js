// Wardrobe (public.clothes) store — the single source of truth for the
// client's digital closet, replacing the old `wardrobe` array + related
// actions that used to live on useUserStore (a wardrobe item CRUD concern
// never really belonged on the profile store, and it needs its own async
// loading/error state that useUserStore wasn't designed for). Consumed by
// WardrobeScreen, ItemDetailScreen, StylistScreen, and WeeklyPlanner.
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { supabase } from '../services/supabaseClient';
// Local calendar-day key ("YYYY-MM-DD") — reused rather than reimplemented
// here so the "once per day" rule below and the Planner's own day-keying
// (Style Streak, scheduled outfits) can never drift apart on what "today"
// means. See its own comment in usePlannerStore.js for why this isn't
// `toISOString()` or `toLocaleDateString()`.
import { toDateKey } from './usePlannerStore';

const CLOTHES_BUCKET = 'clothes-photos';

function toPublicImageUrl(imagePath) {
  return supabase.storage.from(CLOTHES_BUCKET).getPublicUrl(imagePath).data.publicUrl;
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

export const useWardrobeStore = create((set, get) => ({
  items: [],
  loading: false,
  error: null,

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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in.');

    const extension = pendingItem.imageUri.split('.').pop()?.split('?')[0] || 'jpg';
    // expo-crypto's named export, not the bare global `crypto` — RN/Hermes
    // doesn't reliably expose Web Crypto's `crypto.randomUUID()` on native
    // the way a browser (this app's web target) does.
    const imagePath = `${user.id}/${Crypto.randomUUID()}.${extension}`;

    // The scanned photo is a local file:// URI at this point (expo-image-
    // picker) — fetch() + blob() is the standard RN way to turn that into
    // upload-able bytes.
    const fileResponse = await fetch(pendingItem.imageUri);
    const fileBlob = await fileResponse.blob();

    const { error: uploadError } = await supabase.storage
      .from(CLOTHES_BUCKET)
      .upload(imagePath, fileBlob, { contentType: fileBlob.type || 'image/jpeg' });
    if (uploadError) throw uploadError;

    const { data: row, error: insertError } = await supabase
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
      .single();

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

  // Called on sign-out / account deletion (see accountService.js) so a
  // second account signing into the same device never sees a flash of the
  // previous user's closet before fetchWardrobe() resolves.
  reset: () => set({ items: [], loading: false, error: null }),
}));
