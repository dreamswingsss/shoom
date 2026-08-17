import { useCallback, useState } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

// Cross-platform "which calendar?" picker for Export to Calendar (see
// calendarService.js's getAvailableCalendars) — iOS gets the real native
// action sheet via ActionSheetIOS, which Android has no equivalent OS API
// for (Expo doesn't expose one), so there it falls back to a plain in-app
// list rendered by components/CalendarPickerModal. Callers await
// `pickCalendar(calendars)` the same way regardless of which path actually
// ran, resolving to the chosen calendar's id or `null` if the client backed
// out without picking one.
export function useCalendarPicker() {
  const { t } = useTranslation();
  // Only ever set on the Android/fallback path — iOS never touches this
  // state, it resolves straight out of ActionSheetIOS's own callback.
  const [pickerState, setPickerState] = useState(null);

  const pickCalendar = useCallback(
    (calendars) =>
      new Promise((resolve) => {
        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options: [...calendars.map((cal) => cal.title), t('calendarPicker.cancel')],
              cancelButtonIndex: calendars.length,
            },
            (index) => resolve(index === calendars.length ? null : calendars[index].id)
          );
          return;
        }
        setPickerState({ calendars, resolve });
      }),
    [t]
  );

  const onSelectCalendar = useCallback((calendarId) => {
    setPickerState((current) => {
      current?.resolve(calendarId);
      return null;
    });
  }, []);

  const onDismissPicker = useCallback(() => {
    setPickerState((current) => {
      current?.resolve(null);
      return null;
    });
  }, []);

  return {
    pickCalendar,
    pickerVisible: !!pickerState,
    pickerCalendars: pickerState?.calendars || [],
    onSelectCalendar,
    onDismissPicker,
  };
}
