// Supabase client — reference implementation for the AsyncStorage migration
// (see supabase/migrations/0001_init.sql). Not imported anywhere yet: wiring
// this in is a cutover (AuthScreen's Google flow, useUserStore, WardrobeScreen
// all need to switch over together), not a drop-in alongside the current
// AsyncStorage-backed stores.
//
// Prerequisites once you're ready to wire this in:
//   npx expo install @supabase/supabase-js react-native-url-polyfill
// and add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (see
// .env.example) from Project Settings -> API in the Supabase dashboard.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// The anon key is safe to ship in the app bundle by design — every table it
// can touch is locked down by the RLS policies in 0001_init.sql, not by
// keeping this key secret. The service_role key used by the Delete Account
// Edge Function must NEVER appear in client code.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // AsyncStorage (not SecureStore) matches every other store's persistence
    // in this app — the session token has the same sensitivity as the rest
    // of what's already sitting in AsyncStorage today.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No browser URL to parse a session out of on native.
    detectSessionInUrl: false,
  },
});
