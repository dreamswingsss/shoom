import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '../theme/tokens';

// Two-column "Most Worn" / "Hidden Gems" strip, fed by calculateInsights().
// Hides itself entirely when there's not enough planner history to say
// anything meaningful yet, rather than showing an empty/placeholder card.
// `neverWornCount` is a separate, Planner-independent signal (see
// calculateInsights' own comment) — shown as a footer line when the card
// renders at all, or on its own (no columns) when there's no Planner
// history yet but the wardrobe already has un-worn items to flag.
export default function InsightsCard({ mostWornItem, leastWornItem, neverWornCount = 0, totalCount = 0 }) {
  const { t } = useTranslation();

  const hasColumns = mostWornItem || leastWornItem;
  if (!hasColumns && neverWornCount === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      {hasColumns && (
        <View style={styles.columnsRow}>
          {mostWornItem && <InsightColumn label={t('closet.insightsCard.mostWorn')} item={mostWornItem} />}
          {mostWornItem && leastWornItem && <View style={styles.divider} />}
          {leastWornItem && <InsightColumn label={t('closet.insightsCard.hiddenGems')} item={leastWornItem} />}
        </View>
      )}
      {neverWornCount > 0 && (
        <Text style={[styles.neverWornText, hasColumns && styles.neverWornTextWithColumns]}>
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
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.sm },
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
