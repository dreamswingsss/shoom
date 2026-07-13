import { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, setAppLanguage } from '../i18n';
import { colors, spacing, radius, typography } from '../theme/tokens';

// Globe-icon trigger + modal language list. Selecting a language switches
// the app instantly (useTranslation subscribes every t()-using component to
// re-render) and persists the choice to AsyncStorage via setAppLanguage.
export default function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const [visible, setVisible] = useState(false);

  function handleSelect(code) {
    setVisible(false);
    if (code === i18n.language) return;
    setAppLanguage(code);
  }

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Feather name="globe" size={20} color={colors.textPrimary} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          {/* Empty onPress claims the touch so it doesn't bubble to the
              backdrop's dismiss handler. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{t('profile.language')}</Text>
            <FlatList
              data={SUPPORTED_LANGUAGES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => {
                const isActive = item.code === i18n.language;
                return (
                  <TouchableOpacity
                    style={[styles.row, isActive && styles.rowActive]}
                    onPress={() => handleSelect(item.code)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.rowText, isActive && styles.rowTextActive]}>{item.label}</Text>
                    {isActive && <Feather name="check" size={16} color={colors.textPrimary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  sheetTitle: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowActive: { backgroundColor: colors.surface },
  rowText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  rowTextActive: { fontWeight: '700' },
});
