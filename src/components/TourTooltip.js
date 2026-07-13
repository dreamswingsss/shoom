import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useCopilot } from 'react-native-copilot';
import { colors, spacing, radius } from '../theme/tokens';

export default function TourTooltip() {
  const { goToNext, goToPrev, stop, currentStep, isFirstStep, isLastStep } = useCopilot();

  return (
    <View style={styles.tooltip}>
      <Text style={styles.text}>{currentStep?.text}</Text>

      <View style={styles.actions}>
        <Pressable
          onPress={stop}
          style={({ pressed }) => [styles.ghostBtn, pressed && styles.ghostBtnPressed]}
        >
          <Text style={styles.ghostText}>Skip</Text>
        </Pressable>

        <View style={styles.actionsRight}>
          {!isFirstStep && (
            <Pressable
              onPress={goToPrev}
              style={({ pressed }) => [styles.ghostBtn, pressed && styles.ghostBtnPressed]}
            >
              <Text style={styles.ghostText}>Back</Text>
            </Pressable>
          )}
          <Pressable
            onPress={isLastStep ? stop : goToNext}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          >
            <Text style={styles.primaryText}>{isLastStep ? 'Finish' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tooltip: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    borderRadius: radius.lg,
    padding: spacing.sm,
    minWidth: 240,
    maxWidth: 280,
    // Explicitly flat — no shadow/elevation on either platform.
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  text: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  actionsRight: { flexDirection: 'row', gap: spacing.xs },
  ghostBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  ghostBtnPressed: { backgroundColor: 'rgba(0,0,0,0.06)' },
  ghostText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: colors.inverseBackground,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  primaryBtnPressed: { opacity: 0.8 },
  primaryText: { color: colors.inverseText, fontSize: 13, fontWeight: '700' },
});
