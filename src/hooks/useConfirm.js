// Cross-platform destructive-confirm — routes to the real OS `Alert.alert`
// on native (iOS/Android, where it's the correct, expected UX) and to
// `ConfirmDialog` (a CenteredModal-based component, see components/
// ConfirmDialog.js) on web, where `Alert.alert` is a silent no-op in
// react-native-web (no dialog ever appears, the confirm/cancel callbacks
// never fire). Screens that used to call `Alert.alert` directly for a
// delete confirmation were, without this, simply broken on web — not
// merely untested there.
//
// Usage:
//   const { confirm, dialogProps, closeDialog, handleConfirm } = useConfirm();
//   ...
//   confirm({ title, message, cancelLabel, confirmLabel, onConfirm: doDelete });
//   ...
//   {dialogProps && (
//     <ConfirmDialog
//       visible
//       onClose={closeDialog}
//       onConfirm={handleConfirm}
//       {...dialogProps}
//     />
//   )}
import { useCallback, useState } from 'react';
import { Platform, Alert } from 'react-native';

export function useConfirm() {
  // Only ever set on web — `confirm()` below never touches this state on
  // native, so `dialogProps` stays `null` there and no <ConfirmDialog> ever
  // mounts (screens should still unconditionally render it behind
  // `dialogProps &&`, it just never becomes true on native).
  const [dialogProps, setDialogProps] = useState(null);

  const confirm = useCallback(
    ({ title, message, cancelLabel, confirmLabel, destructive = true, onConfirm }) => {
      if (Platform.OS !== 'web') {
        Alert.alert(title, message, [
          { text: cancelLabel, style: 'cancel' },
          { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
        ]);
        return;
      }
      setDialogProps({ title, message, cancelLabel, confirmLabel, destructive, onConfirm });
    },
    []
  );

  const closeDialog = useCallback(() => setDialogProps(null), []);

  // Closes BEFORE running the caller's onConfirm — same ordering
  // `Alert.alert`'s own button press already gives on native (the dialog
  // dismisses, then the button's onPress fires), so a caller that
  // navigates away (e.g. `navigation.goBack()`) doesn't do so while this
  // modal is still technically visible/animating out.
  const handleConfirm = useCallback(() => {
    const onConfirm = dialogProps?.onConfirm;
    setDialogProps(null);
    onConfirm?.();
  }, [dialogProps]);

  return { confirm, dialogProps, closeDialog, handleConfirm };
}
