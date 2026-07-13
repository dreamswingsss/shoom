import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme/tokens';

// Single-select chip row — shared by WardrobeScreen's scan-confirm step and
// ItemDetailScreen's inline edit panel, both of which pick one value (category
// or color) from a fixed option list.
export function ChipPicker({ options, value, onSelect, getLabel }) {
  return (
    <View style={styles.wrap}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[styles.chip, value === option && styles.chipActive]}
          onPress={() => onSelect(option)}
          activeOpacity={0.8}
        >
          <Text style={[styles.chipText, value === option && styles.chipTextActive]}>
            {getLabel ? getLabel(option) : option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, paddingBottom: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipActive: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  chipText: { color: colors.textPrimary, fontSize: 13 },
  chipTextActive: { color: colors.inverseText },
});
