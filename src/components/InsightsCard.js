import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '../theme/tokens';

// "Most Worn" strip, fed by calculateInsights(). Hides itself entirely
// when there's not enough planner history to say anything meaningful yet,
// rather than showing an empty/placeholder card.
//
// Used to also show a "Hidden Gems" (least-worn) column and a never-worn-
// count footer line — both dropped at the user's request (read as visual
// clutter/unwanted nagging, not useful information — the never-worn line
// in particular fired the moment a single freshly-scanned item existed,
// which is trivially true of every item ever added and told the client
// nothing they didn't already know).
export default function InsightsCard({ mostWornItem }) {
  const { t } = useTranslation();

  if (!mostWornItem) {
    return null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.columnsRow}>
        <InsightColumn label={t('closet.insightsCard.mostWorn')} item={mostWornItem} />
      </View>
    </View>
  );
}

function InsightColumn({ label, item }) {
  return (
    <View style={styles.column}>
      <Image source={{ uri: item.imageUri }} style={styles.image} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.itemName} numberOfLines={1}>
        {item.subcategory}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.sm,
  },
  columnsRow: { flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center' },
  image: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  label: { ...typography.label, fontSize: 10 },
  itemName: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginTop: 2 },
});
