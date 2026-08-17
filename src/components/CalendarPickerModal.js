// Android/fallback half of useCalendarPicker — iOS gets the real native
// ActionSheetIOS instead (see that hook's own comment on why Android has no
// equivalent). Same plain-Modal-list shape as InspirationDetailScreen's own
// CalendarExportModal (a day list, not calendars) — duplicated rather than
// shared, same call as that component's own exportSheet: a small,
// screen-local style block not worth a shared component for what's still
// just two users.
import { Modal, Pressable, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, shadows, typography } from '../theme/tokens';

export default function CalendarPickerModal({ visible, calendars, onSelect, onClose }) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{t('calendarPicker.title')}</Text>
          {calendars.map((cal) => (
            <TouchableOpacity
              key={cal.id}
              style={styles.row}
              onPress={() => onSelect(cal.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.rowText}>{cal.title}</Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.premiumBackground,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    ...shadows.soft,
  },
  title: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
});
