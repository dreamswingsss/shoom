import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '../theme/tokens';

// "Most Worn" strip, fed by calculateInsights(). Hides itself entirely
// when there's not enough planner history to say anything meaningful yet,
// rather than showing an empty/placeholder card. `neverWornCount` is a
// separate, Planner-independent signal (see calculateInsights' own
// comment) — shown as a footer line when the card renders at all, or on
// its own (no column) when there's no Planner history yet but the
// wardrobe already has un-worn items to flag.
//
// Used to also show a second "Hidden Gems" (least-worn) column — dropped
// at the user's request (read as visual clutter, not useful information).
export default function InsightsCard({ mostWornItem, neverWornCount = 0, totalCount = 0 }) {
  const { t } = useTranslation();

  if (!mostWornItem && neverWornCount === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      {mostWornItem && (
        <View style={styles.columnsRow}>
          <InsightColumn label={t('closet.insightsCard.mostWorn')} item={mostWornItem} />
        </View>
      )}
      {neverWornCount > 0 && (
        <Text style={[styles.neverWornText, mostWornItem && styles.neverWornTextWithColumns]}>
          {t('closet.insightsCard.neverWorn', { count: neverWornCount, total: totalCount })}
        </Text>
      )}
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
  neverWornText: { ...typography.bodySecondary, fontSize: 12.5, textAlign: 'center' },
  neverWornTextWithColumns: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
