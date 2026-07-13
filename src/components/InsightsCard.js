import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '../theme/tokens';

// Two-column "Most Worn" / "Hidden Gems" strip, fed by calculateInsights().
// Hides itself entirely when there's not enough planner history to say
// anything meaningful yet, rather than showing an empty/placeholder card.
export default function InsightsCard({ mostWornItem, leastWornItem }) {
  const { t } = useTranslation();

  if (!mostWornItem && !leastWornItem) {
    return null;
  }

  return (
    <View style={styles.card}>
      {mostWornItem && <InsightColumn label={t('closet.insightsCard.mostWorn')} item={mostWornItem} />}
      {mostWornItem && leastWornItem && <View style={styles.divider} />}
      {leastWornItem && <InsightColumn label={t('closet.insightsCard.hiddenGems')} item={leastWornItem} />}
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
    flexDirection: 'row',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
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
});
