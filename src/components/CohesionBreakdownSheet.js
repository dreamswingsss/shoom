import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import BottomSheet from './BottomSheet';
import { colors, spacing, radius, typography, buttons } from '../theme/tokens';

const MAX_SCORES = { category: 40, color: 30, worn: 30 };

// The capsule-score tile's tap used to either show a generic paywall alert
// (free) or do literally nothing (Pro — no real breakdown screen existed
// for either tier). This is that screen: the three sub-scores
// getCohesionBreakdown() already computes are ALWAYS real and visible here,
// for every tier — free-tier upgrade pressure comes from the "Рекомендации"
// section specifically being locked, not from hiding the numbers
// themselves. Same LockableTile-style dim+lock-badge shape as the rest of
// the app, just applied inline to one section of a sheet instead of a whole
// Hub tile.
export default function CohesionBreakdownSheet({ visible, onClose, breakdown, isPro, onUpgradePress }) {
  const { t } = useTranslation();
  const { categoryScore = 0, colorBalanceScore = 0, wornScore = 0 } = breakdown || {};

  // Whichever sub-score is furthest below its own max (as a ratio, not raw
  // points — category's 40 vs. worn's 30 aren't directly comparable) is the
  // one real, specific tip shown — one concrete "fix this" beats three
  // generic ones.
  const ratios = [
    { key: 'category', ratio: categoryScore / MAX_SCORES.category, tipKey: 'tipCategory' },
    { key: 'color', ratio: colorBalanceScore / MAX_SCORES.color, tipKey: 'tipColor' },
    { key: 'worn', ratio: wornScore / MAX_SCORES.worn, tipKey: 'tipWorn' },
  ];
  const lowest = ratios.reduce((min, entry) => (entry.ratio < min.ratio ? entry : min), ratios[0]);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="80%">
      <View style={styles.wrap}>
        <Text style={styles.title}>{t('closet.hub.capsuleScore.breakdown.title')}</Text>

        <ScoreBar
          label={t('closet.hub.capsuleScore.breakdown.categoryLabel')}
          value={categoryScore}
          max={MAX_SCORES.category}
        />
        <ScoreBar
          label={t('closet.hub.capsuleScore.breakdown.colorLabel')}
          value={colorBalanceScore}
          max={MAX_SCORES.color}
        />
        <ScoreBar
          label={t('closet.hub.capsuleScore.breakdown.wornLabel')}
          value={wornScore}
          max={MAX_SCORES.worn}
        />

        <Text style={styles.tipsTitle}>{t('closet.hub.capsuleScore.breakdown.tipsTitle')}</Text>

        {isPro ? (
          <View style={styles.tipCard}>
            <Feather name="zap" size={14} color={colors.violet} />
            <Text style={styles.tipText}>{t(`closet.hub.capsuleScore.breakdown.${lowest.tipKey}`)}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.lockedTipCard} onPress={onUpgradePress} activeOpacity={0.85}>
            <View style={styles.lockedTipContent} pointerEvents="none">
              <Feather name="zap" size={14} color={colors.violet} />
              <Text style={[styles.tipText, styles.lockedTipText]} numberOfLines={2}>
                {t(`closet.hub.capsuleScore.breakdown.${lowest.tipKey}`)}
              </Text>
            </View>
            <View style={styles.lockedOverlay}>
              <View style={styles.lockBadge}>
                <Feather name="lock" size={12} color={colors.inverseText} />
              </View>
              <Text style={styles.lockedMessage}>{t('closet.hub.capsuleScore.breakdown.lockedMessage')}</Text>
              <View style={styles.lockedCtaBtn}>
                <Text style={styles.lockedCtaText}>{t('closet.hub.capsuleScore.breakdown.lockedCta')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

function ScoreBar({ label, value, max }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <View style={styles.scoreRow}>
      <View style={styles.scoreLabelRow}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <Text style={styles.scoreValue}>{Math.round(value)}/{max}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  title: { ...typography.h2, fontSize: 19, marginBottom: spacing.md },

  scoreRow: { marginBottom: spacing.sm },
  scoreLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  scoreLabel: { ...typography.rowTitle, fontSize: 13.5 },
  scoreValue: { ...typography.captionSecondary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: colors.violet },

  tipsTitle: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.sm },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  tipText: { ...typography.bodySecondary, fontSize: 13.5, flex: 1, lineHeight: 19 },

  // Same "visible but not usable" shape LockableTile already uses on Hub
  // tiles — dimmed real content underneath (pointerEvents disabled so a tap
  // always hits the overlay, never the text), a lock badge, and here also a
  // short teaser line + explicit CTA button, since this is one section of a
  // sheet rather than a whole tile with its own obvious next step.
  lockedTipCard: {
    position: 'relative',
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  lockedTipContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    opacity: 0.35,
  },
  lockedTipText: { color: colors.textMuted },
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  lockBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.inverseBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedMessage: { ...typography.captionSecondary, textAlign: 'center' },
  lockedCtaBtn: {
    backgroundColor: colors.violet,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 2,
  },
  lockedCtaText: { ...buttons.primaryText, fontSize: 12.5 },
});
