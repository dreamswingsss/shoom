import * as Haptics from 'expo-haptics';

// expo-haptics has no web implementation — it rejects there (and can throw
// on some Android/iOS edge cases like a muted accessibility setting), so this
// is always fire-and-forget. Never awaited, never lets a haptic failure
// interrupt the tap it's decorating.
export function triggerHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
