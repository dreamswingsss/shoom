// Cross-platform action sheet — same native/web split useConfirm() already
// uses for its own confirm/cancel dialog, extended to an arbitrary list of
// options instead of a fixed 2-button row:
//   - iOS: the real ActionSheetIOS bottom sheet — standard platform UX for
//     exactly this "pick one of several actions" menu.
//   - Android: Alert.alert with one button per option — there's no
//     ActionSheetIOS equivalent there, and Android's own Alert already
//     renders 3+ buttons stacked, which reads fine for this.
//   - Web: `sheetProps` below, paired with `ActionSheetModal` (same folder's
//     sibling component) — Alert.alert is a silent no-op on
//     react-native-web (see ConfirmDialog's own comment for why), and
//     ActionSheetIOS doesn't exist there at all.
//
// Usage:
//   const { showActionSheet, sheetProps, closeActionSheet, handleOptionPress } = useActionSheet();
//   ...
//   showActionSheet({
//     title: t('stylist.attachMenu.title'),
//     options: [
//       { label: t('stylist.attachMenu.camera'), onPress: handleTakePhoto },
//       { label: t('stylist.attachMenu.library'), onPress: handleChooseFromGallery },
//       { label: t('stylist.attachMenu.cancel'), cancel: true },
//     ],
//   });
//   ...
//   <ActionSheetModal
//     visible={!!sheetProps}
//     onClose={closeActionSheet}
//     onSelect={handleOptionPress}
//     title={sheetProps?.title}
//     options={sheetProps?.options}
//   />
import { useCallback, useState } from 'react';
import { Platform, Alert, ActionSheetIOS } from 'react-native';

export function useActionSheet() {
  // Only ever set on web — showActionSheet below never touches this state
  // on native, so `sheetProps` stays `null` there and no <ActionSheetModal>
  // ever mounts (screens should still unconditionally render it behind
  // `!!sheetProps`, it just never becomes true on native).
  const [sheetProps, setSheetProps] = useState(null);

  // `options`: array of `{ label, onPress, destructive?, cancel? }`.
  // `cancel` marks the dismiss option (-> ActionSheetIOS's
  // cancelButtonIndex / Alert's 'cancel' style / an extra top gap on web).
  // `destructive` marks a deletion-style action (-> ActionSheetIOS's
  // destructiveButtonIndex / Alert's 'destructive' style / colors.danger
  // text on web).
  const showActionSheet = useCallback(({ title, options }) => {
    if (Platform.OS === 'ios') {
      const cancelButtonIndex = options.findIndex((o) => o.cancel);
      const destructiveButtonIndex = options.findIndex((o) => o.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: options.map((o) => o.label),
          cancelButtonIndex: cancelButtonIndex >= 0 ? cancelButtonIndex : undefined,
          destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined,
        },
        (index) => options[index]?.onPress?.()
      );
      return;
    }

    if (Platform.OS === 'android') {
      Alert.alert(
        title,
        undefined,
        options.map((o) => ({
          text: o.label,
          style: o.cancel ? 'cancel' : o.destructive ? 'destructive' : 'default',
          onPress: o.onPress,
        }))
      );
      return;
    }

    setSheetProps({ title, options });
  }, []);

  // Web's own dismiss path — backdrop tap. No option's onPress fires here,
  // same as tapping outside a native ActionSheetIOS sheet just closes it.
  const closeActionSheet = useCallback(() => {
    setSheetProps(null);
  }, []);

  // Closes BEFORE running the picked option's onPress — same ordering
  // useConfirm's own handleConfirm uses, so a caller that navigates away
  // (or opens another modal) doesn't do so while this one is still
  // technically visible/animating out.
  const handleOptionPress = useCallback((option) => {
    setSheetProps(null);
    option?.onPress?.();
  }, []);

  return { showActionSheet, sheetProps, closeActionSheet, handleOptionPress };
}
