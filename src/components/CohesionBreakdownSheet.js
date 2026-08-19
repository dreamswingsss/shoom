import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import BottomSheet from './BottomSheet';
import { colors, spacing, radius, shadows, typography, buttons } from '../theme/tokens';

const MAX_SCORES = { category: 40, color: 30, style: 30 };

// The capsule-score tile's tap used to either show a generic paywall alert
// (free) or do literally nothing (Pro — no real breakdown screen existed
// for either tier). This is that screen — real content only for Pro; a
// free-tier client sees LockedState below instead, not the real numbers.
//
// An earlier version showed the three real bars to every tier and only
// locked the "Рекомендации" tip (a dimmed real card + an absolutely-
// positioned lock overlay on top of it). That overlay used
// `StyleSheet.absoluteFillObject` inside an `overflow: hidden` parent whose
// own height came from its dimmed child — react-native-web resolves that
// differently across WebViews, and on Android's (Chrome-based) WebView the
// overlay rendered well below where its content actually was instead of
// centered over it. Free tier not seeing the real numbers at all (this
// screen's own actual product requirement, not just a layout fix) sidesteps
// that whole class of bug: LockedState needs no absolute positioning
// because there's nothing real underneath it to overlay.
export default function CohesionBreakdownSheet({ visible, onClose, breakdown, isPro, onUpgradePress }) {
  const { t } = useTranslation();
  const { categoryScore = 0, colorBalanceScore = 0, styleScore = 0 } = breakdown || {};

  // Whichever sub-score is furthest below its own max (as a ratio, not raw
  // points — category's 40 vs. style's 30 aren't directly comparable) is the
  // one real, specific tip shown — one concrete "fix this" beats three
  // generic ones. Only ever computed/shown for Pro.
  const ratios = [
    { key: 'category', ratio: categoryScore / MAX_SCORES.category, tipKey: 'tipCategory' },
    { key: 'color', ratio: colorBalanceScore / MAX_SCORES.color, tipKey: 'tipColor' },
    { key: 'style', ratio: styleScore / MAX_SCORES.style, tipKey: 'tipStyle' },
  ];
  const lowest = ratios.reduce((min, entry) => (entry.ratio < min.ratio ? entry : min), ratios[0]);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="80%">
      <View style={styles.wrap}>
        <Text style={styles.title}>{t('closet.hub.capsuleScore.breakdown.title')}</Text>

        {isPro ? (
          <>
            <ScoreBar
              label={t('closet.hub.capsuleScore.breakdown.categoryLabel')}
              hint={t('closet.hub.capsuleScore.breakdown.categoryHint')}
              value={categoryScore}
              max={MAX_SCORES.category}
            />
            <ScoreBar
              label={t('closet.hub.capsuleScore.breakdown.colorLabel')}
              hint={t('closet.hub.capsuleScore.breakdown.colorHint')}
              value={colorBalanceScore}
              max={MAX_SCORES.color}
            />
            <ScoreBar
              label={t('closet.hub.capsuleScore.breakdown.styleLabel')}
              hint={t('closet.hub.capsuleScore.breakdown.styleHint')}
              value={styleScore}
              max={MAX_SCORES.style}
            />

            <Text style={styles.tipsTitle}>{t('closet.hub.capsuleScore.breakdown.tipsTitle')}</Text>
            <View style={styles.tipCard}>
              <Feather name="zap" size={14} color={colors.violet} />
              <Text style={styles.tipText}>{t(`closet.hub.capsuleScore.breakdown.${lowest.tipKey}`)}</Text>
            </View>
          </>
        ) : (
          <LockedState onUpgradePress={onUpgradePress} />
        )}
      </View>
    </BottomSheet>
  );
}

// Plain document-flow block, same gradient-icon-circle/title/message/pill-
// button shape ScanSheet's "you need an account" prompt and
// ProActivatedModal already use elsewhere in this app — no absolute
// positioning, see this file's own top comment for why.
function LockedState({ onUpgradePress }) {
  const { t } = useTranslation();
  return (
    <View style={styles.lockedWrap}>
      <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.lockedIconWrap}>
        <Feather name="lock" size={24} color={colors.inverseText} />
      </LinearGradient>
      <Text style={styles.lockedTitle}>{t('closet.hub.capsuleScore.breakdown.lockedMessage')}</Text>
      <Text style={styles.lockedSubtitle}>{t('closet.hub.capsuleScore.breakdown.lockedSubtitle')}</Text>

      <TouchableOpacity style={styles.lockedCtaBtn} onPress={onUpgradePress} activeOpacity={0.85}>
        <Text style={styles.lockedCtaText}>{t('closet.hub.capsuleScore.breakdown.lockedCta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ScoreBar({ label, hint, value, max }) {
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
      {hint && <Text style={styles.scoreHint}>{hint}</Text>}
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
  // Short "what this actually measures" line — added because the bare
  // label + fraction (e.g. "Разнообразие категорий · 0/40") read as
  // meaningless numbers with no explanation of what they're even scoring.
  scoreHint: { ...typography.captionSecondary, fontSize: 11.5, marginTop: 4 },

  tipsTitle: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.sm },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    // Solid ink outline — same "deliberate dark accent" convention
    // PricingScreen's own tier cards use (colors.textPrimary, 1.5), not
    // the faint colors.border every other card in this sheet's ancestry
    // defaults to — this is the one actionable recommendation in the
    // sheet, so it reads as a distinct, deliberate callout.
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    padding: spacing.sm,
  },
  tipText: { ...typography.bodySecondary, fontSize: 13.5, flex: 1, lineHeight: 19 },

  // Free-tier state — plain document flow, no absolute positioning (see
  // this file's own top comment for why that matters here specifically).
  // Same gradient-icon-circle/title/message/pill-button shape as
  // ScanSheet's "you need an account" prompt and ProActivatedModal.
  lockedWrap: { alignItems: 'center', paddingVertical: spacing.md },
  lockedIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.cardLg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  lockedTitle: { ...typography.h2, fontSize: 17, textAlign: 'center', marginBottom: spacing.xs },
  lockedSubtitle: {
    ...typography.bodySecondary,
    fontSize: 13.5,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  lockedCtaBtn: {
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.accent,
  },
  lockedCtaText: { ...buttons.primaryText, fontSize: 14.5 },
});
