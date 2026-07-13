// Client side of Delete Account — invokes the delete-account Edge Function
// (supabase/functions/delete-account/index.ts) for the actual server-side
// deletion, then clears every locally persisted store so a re-login (even
// as a *different* account, same device) never shows a flash of stale data.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { usePlannerStore } from '../store/usePlannerStore';
import { useChatStore } from '../store/useChatStore';

export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;

  // Session is already gone server-side (the auth user no longer exists) —
  // this just clears the locally cached tokens so supabase-js stops trying
  // to refresh them.
  await supabase.auth.signOut();

  useWardrobeStore.getState().reset();
  useUserStore.getState().logout();
  usePlannerStore.getState().reset();
  useChatStore.getState().clearMessages();

  // Belt-and-suspenders: each store's persist middleware writes to
  // AsyncStorage on its own schedule, so a broad clear() guarantees nothing
  // written moments before this ran survives on disk either.
  await AsyncStorage.clear();
}
