// Single source of truth for "is this the admin account" — used both to
// gate ProfileScreen's broadcast card and to grant the admin permanent Pro
// access (useSupabaseAuthSync.js). Client-side only: a UI/UX convenience,
// never a security boundary — broadcast-notification's own Edge Function
// re-checks the caller's telegram_id against its own ADMIN_TELEGRAM_ID
// secret server-side regardless of what this returns.
export const ADMIN_TELEGRAM_ID = process.env.EXPO_PUBLIC_ADMIN_TELEGRAM_ID
  ? Number(process.env.EXPO_PUBLIC_ADMIN_TELEGRAM_ID)
  : null;

export function isAdminTelegramId(telegramId) {
  return ADMIN_TELEGRAM_ID != null && telegramId === ADMIN_TELEGRAM_ID;
}
