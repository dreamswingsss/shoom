import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { usePlannerStore, toDateKey, getStyleStreak } from '../store/usePlannerStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useChatStore } from '../store/useChatStore';
import { useUserStore } from '../store/useUserStore';
import { formatWeekdayShort, formatWeekdayLong, formatWeekdayShortWithDate } from '../utils/dateFormat';
import { getInitials } from '../utils/getInitials';
import { colors, cardTints, spacing, radius, typography } from '../theme/tokens';
import Skeleton from '../components/Skeleton';

const DAY_COUNT = 7;
// Cycles through the redesign's three "plan card" tints in a fixed order —
// real scheduled entries, not the mockup's 3 fixed placeholder categories.
const PLAN_CARD_TINTS = ['coral', 'sky', 'violet'];

function buildWeekDays() {
  const today = new Date();
  return Array.from({ length: DAY_COUNT }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    return date;
  });
}

// Real summary of what was actually saved for a day — wardrobe item
// subcategories if it's a from-closet outfit, else the first suggested-to-
// buy item's name. Mirrors the same lookup StylistScreen's
// SaveToPlannerButton / thumbnail logic already uses.
function summarizeOutfit(scheduled, wardrobeById) {
  const items = (scheduled.outfitIds || []).map((id) => wardrobeById[id]).filter(Boolean);
  if (items.length > 0) {
    return items.slice(0, 2).map((item) => item.subcategory).join(', ');
  }
  return scheduled.newItems?.[0]?.name || null;
}

export default function PlannerScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const user = useUserStore((state) => state.user);
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const plannerLoading = usePlannerStore((state) => state.loading);
  const fetchOutfits = usePlannerStore((state) => state.fetchOutfits);
  const removeOutfit = usePlannerStore((state) => state.removeOutfit);
  const wardrobe = useWardrobeStore((state) => state.items);
  const setPendingPrompt = useChatStore((state) => state.setPendingPrompt);

  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const wardrobeById = useMemo(
    () => Object.fromEntries(wardrobe.map((item) => [item.id, item])),
    [wardrobe]
  );

  const days = useMemo(buildWeekDays, []);
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const selectedKey = toDateKey(selectedDate);

  const scheduledCount = days.filter((date) => scheduledOutfits[toDateKey(date)]).length;
  const streak = useMemo(() => getStyleStreak(scheduledOutfits), [scheduledOutfits]);

  // Same "only the true first-load has nothing yet" gate WeeklyPlanner used.
  const showLoading = plannerLoading && Object.keys(scheduledOutfits).length === 0;

  // Redundant with WardrobeScreen's own fetchOutfits() — deliberate, same
  // reasoning as the old WeeklyPlanner component: whichever tab is opened
  // first gets fresh data without waiting on the other.
  useEffect(() => {
    fetchOutfits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduledEntries = useMemo(() => {
    return days
      .map((date) => {
        const dateKey = toDateKey(date);
        const scheduled = scheduledOutfits[dateKey];
        return scheduled ? { date, dateKey, scheduled } : null;
      })
      .filter(Boolean);
  }, [days, scheduledOutfits]);

  function handleSelectDay(date) {
    setSelectedDate(date);
    const dateKey = toDateKey(date);
    if (scheduledOutfits[dateKey]) return;

    // Same hand-off WeeklyPlanner's empty-day "+" used: pre-fill, don't
    // auto-send — the client still has to hit send on the Stylist tab.
    const label = formatWeekdayLong(date, i18n.language);
    navigation.navigate('AI Stylist', { initialPrompt: t('planner.askPrompt', { date: label }) });
  }

  function handleRemove(dateKey) {
    Alert.alert(t('planner.removeTitle'), t('planner.removeMessage'), [
      { text: t('planner.cancel'), style: 'cancel' },
      { text: t('planner.remove'), style: 'destructive', onPress: () => removeOutfit(dateKey) },
    ]);
  }

  function handleCameraQuickAction() {
    navigation.navigate('AI Stylist');
  }

  function handleShuffleQuickAction() {
    setPendingPrompt(t('stylist.quickPrompts.surpriseMe'));
    navigation.navigate('AI Stylist');
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <LinearGradient colors={[colors.violet, '#9B87FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
        </LinearGradient>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('planner.screenTitle')}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {t('planner.today')}, {formatWeekdayShortWithDate(new Date(), i18n.language)}
          </Text>
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroBlob} />
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>{t('planner.heroBadge')}</Text>
        </View>
        <Text style={styles.heroTitle}>{t('planner.heroTitle', { count: scheduledCount })}</Text>
        <Text style={styles.heroCaption}>
          {streak > 0 ? t('planner.heroCaptionStreak', { count: streak }) : t('planner.heroCaption')}
        </Text>
      </View>

      {showLoading ? (
        <View style={styles.dayRow}>
          {days.map((date) => (
            <View key={toDateKey(date)} style={styles.dayPillSkeleton}>
              <Skeleton width={28} height={10} />
              <Skeleton width={18} height={15} style={{ marginTop: 6 }} />
            </View>
          ))}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayRow}
        >
          {days.map((date) => {
            const dateKey = toDateKey(date);
            const isSelected = dateKey === selectedKey;
            return (
              <TouchableOpacity
                key={dateKey}
                style={[styles.dayPill, isSelected && styles.dayPillSelected]}
                onPress={() => handleSelectDay(date)}
                activeOpacity={0.8}
              >
                <Text style={[styles.dayPillLabel, isSelected && styles.dayPillLabelSelected]}>
                  {dateKey === todayKey ? t('planner.today') : formatWeekdayShort(date, i18n.language)}
                </Text>
                <Text style={[styles.dayPillDate, isSelected && styles.dayPillLabelSelected]}>
                  {date.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Text style={styles.planLabel}>{t('planner.yourPlan')}</Text>

      <View style={styles.grid}>
        {scheduledEntries.map(({ date, dateKey, scheduled }, index) => {
          const tintKey = PLAN_CARD_TINTS[index % PLAN_CARD_TINTS.length];
          const summary = summarizeOutfit(scheduled, wardrobeById);
          return (
            <TouchableOpacity
              key={dateKey}
              style={[styles.planCard, { backgroundColor: cardTints[tintKey] }]}
              onLongPress={() => handleRemove(dateKey)}
              activeOpacity={0.85}
            >
              <View style={styles.planCardBadge}>
                <Text style={styles.planCardBadgeText}>
                  {dateKey === todayKey ? t('planner.today') : formatWeekdayShort(date, i18n.language)}
                </Text>
              </View>
              <View>
                <Text style={styles.planCardTitle} numberOfLines={2}>
                  {summary || t('planner.plannedLook')}
                </Text>
                <Text style={styles.planCardCaption}>{formatWeekdayShortWithDate(date, i18n.language)}</Text>
              </View>
              <Text style={styles.planCardFooter}>{t('planner.styledByAi')}</Text>
            </TouchableOpacity>
          );
        })}

        <View style={styles.quickActionsCard}>
          <View style={styles.quickActionsRow}>
            <TouchableOpacity
              style={styles.quickActionCircle}
              onPress={handleCameraQuickAction}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="camera" size={15} color={colors.inverseText} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionCircle}
              onPress={handleShuffleQuickAction}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="shuffle" size={15} color={colors.inverseText} />
            </TouchableOpacity>
          </View>
          <Text style={styles.quickActionsCaption}>{t('planner.snapOrShuffle')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // paddingTop set inline above, from real safe-area top inset.
  content: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xl },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 22 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.inverseText, fontSize: 13, fontWeight: '800' },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontFamily: typography.title.fontFamily, fontWeight: '800', fontSize: 16, color: colors.textPrimary },
  headerSubtitle: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginTop: 1 },

  heroCard: {
    backgroundColor: cardTints.coral,
    borderRadius: radius.cardLg,
    padding: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBlob: {
    position: 'absolute',
    top: -26,
    right: -26,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,122,89,0.3)',
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginBottom: spacing.xs,
  },
  heroBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.coral },
  heroTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 4, maxWidth: '78%' },
  heroCaption: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  dayRow: { gap: spacing.xs, paddingBottom: spacing.sm },
  dayPill: {
    width: 52,
    height: 64,
    borderRadius: radius.xl + 2,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dayPillSelected: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  dayPillLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  dayPillDate: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  dayPillLabelSelected: { color: colors.inverseText },
  dayPillSkeleton: { width: 52, height: 64, alignItems: 'center', justifyContent: 'center' },

  planLabel: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  planCard: {
    width: '47%',
    minHeight: 172,
    borderRadius: radius.card,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  planCardBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  planCardBadgeText: { fontSize: 10, fontWeight: '700', color: colors.textPrimary },
  planCardTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: 4, lineHeight: 19 },
  planCardCaption: { fontSize: 11, fontWeight: '600', color: colors.textPrimary, opacity: 0.7 },
  planCardFooter: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, opacity: 0.55 },

  quickActionsCard: {
    width: '47%',
    minHeight: 172,
    borderRadius: radius.card,
    backgroundColor: colors.inverseBackground,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  quickActionsRow: { flexDirection: 'row', gap: spacing.xs },
  quickActionCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionsCaption: { fontSize: 11, fontWeight: '700', color: colors.inverseText, opacity: 0.8 },
});
