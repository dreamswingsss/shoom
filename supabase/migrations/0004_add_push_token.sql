-- Stores the client's Expo Push Token (see src/utils/notifications.js) so a
-- future server-side job / Edge Function can send push notifications via
-- Expo's push service (https://exp.host/--/api/v2/push/send) without the
-- client needing to be online at send time.
alter table public.users
  add column expo_push_token text;
