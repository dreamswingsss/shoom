import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

// Without this, a notification that arrives while the app is open and
// focused is silently swallowed instead of shown — Expo's default behavior
// is to suppress foreground notifications entirely. Set at module load
// (like i18n/index.js's i18n.init()) so it's active before any screen has
// a chance to render, not gated behind a hook mounting.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Requests notification permission and returns an Expo Push Token
// ("ExponentPushToken[...]"), the id Expo's push service uses to route a
// send request to this specific device — or `null` if any of the several
// expected reasons a token isn't obtainable applies:
//   - running on web (Expo's push service targets iOS/Android; the
//     web push path needs its own VAPID key setup this app doesn't have)
//   - a simulator/emulator (Device.isDevice) — push tokens don't work
//     there regardless of permission
//   - the client denied the permission prompt
//   - no EAS project is configured yet (app.json's extra.eas.projectId,
//     populated by running `eas init`) — getExpoPushTokenAsync() requires
//     one to know which project's push credentials to issue a token under
// Never throws — every one of these is an expected, recoverable outcome
// for the caller (skip saving a token this run), not a bug to crash over.
export async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') return null;

  if (!Device.isDevice) {
    if (__DEV__) console.warn('[notifications] Push tokens require a physical device, not a simulator.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    if (__DEV__) console.warn('[notifications] Permission not granted.');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    if (__DEV__) {
      console.warn(
        '[notifications] No EAS project configured (app.json extra.eas.projectId is empty) — run `eas init` first.'
      );
    }
    return null;
  }

  // Android 8+ groups notifications into channels and won't display one
  // with no matching channel — this has to exist before a notification can
  // show at all, independent of the foreground handler set up above.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token;
  } catch (err) {
    if (__DEV__) console.warn('[notifications] Failed to get push token:', err.message);
    return null;
  }
}
