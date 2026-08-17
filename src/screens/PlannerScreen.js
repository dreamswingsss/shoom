import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { usePlannerStore, toDateKey, getStyleStreak, getPlannedDaysCount } from '../store/usePlannerStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useChatStore } from '../store/useChatStore';
import { useUserStore } from '../store/useUserStore';
import { formatWeekdayShort, formatWeekdayLong, formatWeekdayShortWithDate } from '../utils/dateFormat';
import { getInitials } from '../utils/getInitials';
import { colors, cardTints, spacing, radius, typography, withAlpha } from '../theme/tokens';
import Skeleton from '../components/Skeleton';
import ScreenContainer from '../components/ScreenContainer';
import ConfirmDialog from '../components/ConfirmDialog';
import PaywallModal from '../components/PaywallModal';
import CalendarPickerModal from '../components/CalendarPickerModal';
import Toast from '../components/Toast';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { usePaywall } from '../hooks/usePaywall';
import { useCalendarPicker } from '../hooks/useCalendarPicker';
import { TourTarget } from '../components/AppTour';
import {
  getAvailableCalendars,
  exportOutfitToCalendar,
  deleteCalendarEvent,
  CalendarPermissionDeniedError,
  CalendarWebUnavailableError,
} from '../services/calendarService';
import { FREE_PLANNED_DAYS_LIMIT } from '../constants/monetization';

const DAY_COUNT = 7;
// v7 — restores the mockup's per-card tint cycling (`planCardCoralStyle`/
// `planCardSkyStyle`/`planCardVioletStyle`), removed in an earlier pass
// that flattened every plan card to plain white/glass. Confirmed by
// clicking through the actual mockup: "Business"=coral, "Casual"=sky,
// "Date Night"/further cards continue the same 3-color rotation, not a
// fixed per-category mapping.
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

// Every piece in a scheduled day's outfit, for Export to Calendar's own
// event `notes` — unlike summarizeOutfit's own 2-item, subcategory-only
// card title, the calendar event has room for the full list, so this pulls
// color + subcategory for wardrobe pieces (a plain subcategory alone reads
// as "Top", not "the top I meant") plus every suggested-to-buy item's name.
function getScheduledItemNames(scheduled, wardrobeById) {
  const wardrobeNames = (scheduled.outfitIds || [])
    .map((id) => wardrobeById[id])
    .filter(Boolean)
    .map((item) => `${item.color} ${item.subcategory}`);
  const suggestedNames = (scheduled.newItems || []).map((entry) => entry.name).filter(Boolean);
  return [...wardrobeNames, ...suggestedNames];
}

export default function PlannerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const user = useUserStore((state) => state.user);
  const isLoggedIn = useUserStore((state) => state.isLoggedIn);
  const isPro = useUserStore((state) => state.isPro);
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const plannerLoading = usePlannerStore((state) => state.loading);
  const fetchOutfits = usePlannerStore((state) => state.fetchOutfits);
  const removeOutfit = usePlannerStore((state) => state.removeOutfit);
  const setOutfitEventId = usePlannerStore((state) => state.setOutfitEventId);
  const wardrobe = useWardrobeStore((state) => state.items);
  const setPendingPrompt = useChatStore((state) => state.setPendingPrompt);

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [exporting, setExporting] = useState(false);
  const { confirm, dialogProps, closeDialog, handleConfirm } = useConfirm();
  const { toastMessage, toastKey, showToast } = useToast();
  const { paywallMessage, showPaywall, closePaywall } = usePaywall();
  const { pickCalendar, pickerVisible, pickerCalendars, onSelectCalendar, onDismissPicker } =
    useCalendarPicker();

  const wardrobeById = useMemo(
    () => Object.fromEntries(wardrobe.map((item) => [item.id, item])),
    [wardrobe]
  );

  const days = useMemo(buildWeekDays, []);
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const selectedKey = toDateKey(selectedDate);
  const selectedEntry = scheduledOutfits[selectedKey] || null;

  // Freemium cap's own count — every key in `scheduledOutfits` is a unique
  // planned date already (see getPlannedDaysCount's own comment). Used for
  // both the hero's "N of 7 days planned" badge and the gate below, so the
  // two can never drift apart on what "planned" means.
  const plannedDaysCount = useMemo(() => getPlannedDaysCount(scheduledOutfits), [scheduledOutfits]);
  // Whether creating a NEW plan for the selected day is currently allowed —
  // `isPro` always wins; a day that's already planned is always re-plannable
  // (replacing its look doesn't add to the count, see scheduleOutfit's own
  // comment); otherwise only true while under FREE_PLANNED_DAYS_LIMIT.
  const canPlanSelectedDay = isPro || !!selectedEntry || plannedDaysCount < FREE_PLANNED_DAYS_LIMIT;
  // Cycles by day-of-week rather than a fixed color — "Your plan" now shows
  // only one card at a time (no more index to cycle tints across), so this
  // is what keeps the card's own color changing as the client browses
  // different days instead of it going flat/static.
  const selectedTint = PLAN_CARD_TINTS[selectedDate.getDay() % PLAN_CARD_TINTS.length];
  const streak = useMemo(() => getStyleStreak(scheduledOutfits), [scheduledOutfits]);

  // Same "only the true first-load has nothing yet" gate WeeklyPlanner used
  // — `isLoggedIn` guards it too now (see the effect below): a guest never
  // sets `plannerLoading` true in the first place, so this can never get
  // stuck showing the skeleton row forever for someone with no session.
  const showLoading = isLoggedIn && plannerLoading && Object.keys(scheduledOutfits).length === 0;

  // Redundant with WardrobeScreen's own fetchOutfits() — deliberate, same
  // reasoning as the old WeeklyPlanner component: whichever tab is opened
  // first gets fresh data without waiting on the other.
  //
  // Gated on `isLoggedIn` — a guest (no Supabase session) has nothing to
  // fetch: `outfits` is RLS-scoped to `auth.uid()`, so this call would
  // either come back empty or error for them anyway, and either outcome
  // used to leave the week's day-of-week row hostage to a network round
  // trip it never actually needed. Skipping the call entirely means a guest
  // (or a signed-in client with a genuinely empty plan) sees the full
  // 7-day structure immediately, with empty slots, instead of a skeleton
  // that either resolves late or — on a slow/failed request — never
  // resolves at all.
  useEffect(() => {
    if (isLoggedIn) fetchOutfits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Pure day selection now — every pill is clickable regardless of tier
  // (see the day-row render below), and picking one only changes which
  // day's plan "Your plan" shows. Creating a NEW plan is its own explicit
  // action (handlePlanPress/handleShufflePress below), not an automatic
  // side effect of tapping an empty day — that's what let a client end up
  // in the AI Stylist chat without ever meaning to leave this screen.
  function handleSelectDay(date) {
    setSelectedDate(date);
  }

  // Smart Delete — a day with no exported calendar event (see
  // handleExportPress) just clears immediately, same as before. A day that
  // WAS exported gets one extra question first: whether to take the
  // matching system-calendar event down with it, since removing the plan
  // here silently orphaning an event still sitting on the client's own
  // Apple/Google Calendar was the actual bug this closes.
  function handleRemove(dateKey) {
    const eventId = scheduledOutfits[dateKey]?.eventId;

    if (!eventId) {
      removeOutfit(dateKey);
      return;
    }

    async function removeAndDeleteEvent() {
      try {
        await deleteCalendarEvent(eventId);
      } catch (err) {
        // The client may have already deleted this event by hand in their
        // own calendar app (or revoked calendar permission) since it was
        // exported — either way the planner-side removal below still has
        // to go through, so this is swallowed rather than surfaced.
        console.error('[PlannerScreen] Calendar event delete failed:', err);
      }
      removeOutfit(dateKey);
    }

    // useConfirm() routes to the real OS Alert on native and to a
    // CenteredModal-based dialog on web — `Alert.alert` alone is a silent
    // no-op in react-native-web, which would otherwise make this button do
    // nothing at all for a web client. `onCancel` here is the "No, keep in
    // calendar" branch: unlike a typical confirm dialog, declining still
    // removes the plan — it only opts out of touching the calendar event.
    confirm({
      title: t('planner.removeCalendarTitle'),
      message: t('planner.removeCalendarMessage'),
      cancelLabel: t('planner.removeCalendarKeep'),
      confirmLabel: t('planner.removeCalendarDelete'),
      onConfirm: removeAndDeleteEvent,
      onCancel: () => removeOutfit(dateKey),
    });
  }

  // "Plan outfit" CTA in the selected day's empty state — same hand-off
  // WeeklyPlanner's old empty-day "+" used: pre-fill, don't auto-send, the
  // client still has to hit send on the Stylist tab. Gated by
  // canPlanSelectedDay first: a free client already at the 2-day cap trying
  // to start a plan for a THIRD day gets the paywall instead of a wasted
  // trip to the chat tab.
  function handlePlanPress() {
    if (!canPlanSelectedDay) {
      showPaywall(t('paywall.plannerDaysLimitMessage'));
      return;
    }
    const label = formatWeekdayLong(selectedDate);
    navigation.navigate('AI Stylist', { initialPrompt: t('planner.askPrompt', { date: label }) });
  }

  function handleShufflePress() {
    if (!canPlanSelectedDay) {
      showPaywall(t('paywall.plannerDaysLimitMessage'));
      return;
    }
    setPendingPrompt(t('stylist.quickPrompts.surpriseMe'));
    navigation.navigate('AI Stylist');
  }

  // Export to Calendar — always acts on the currently selected day's own
  // plan (unlike InspirationDetailScreen's version of this button, which
  // needs its own day-picker since a saved Lookbook look isn't tied to any
  // one date; here the card already IS a specific date, so exporting is a
  // single tap with no extra picker).
  async function handleExportPress() {
    if (!isPro) {
      showPaywall(t('paywall.calendarExportMessage'));
      return;
    }
    if (exporting || !selectedEntry) return;
    setExporting(true);
    try {
      const calendars = await getAvailableCalendars();
      if (calendars.length === 0) {
        showToast(t('closet.inspirationDetail.exportNoCalendars'));
        return;
      }
      const calendarId = await pickCalendar(calendars);
      if (!calendarId) return; // client backed out of the picker

      const itemNames = getScheduledItemNames(selectedEntry, wardrobeById);
      const eventId = await exportOutfitToCalendar({ itemNames, date: selectedDate, calendarId });
      // Smart Delete's write side — lets a later handleRemove for this same
      // day find and offer to clean up this exact event.
      setOutfitEventId(selectedKey, eventId);
      // Reuses closet.inspirationDetail's own calendar-export copy — same
      // messages, same feature, just a different entry point onto it, not
      // worth duplicating across 7 locales for an identical string.
      showToast(t('closet.inspirationDetail.exportSuccess'));
    } catch (err) {
      if (err instanceof CalendarPermissionDeniedError) {
        showToast(t('closet.inspirationDetail.exportPermissionDenied'));
      } else if (err instanceof CalendarWebUnavailableError) {
        showToast(t('closet.inspirationDetail.exportWebUnavailable'));
      } else {
        console.error('[PlannerScreen] Calendar export failed:', err);
        showToast(err.message || t('closet.inspirationDetail.exportGenericError'));
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScreenContainer edges={['top']} contentStyle={[styles.content, { paddingTop: spacing.sm }]}>
      <View style={styles.headerRow}>
        <LinearGradient colors={[colors.violet, colors.violetLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
        </LinearGradient>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('planner.screenTitle')}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {t('planner.today')}, {formatWeekdayShortWithDate(new Date())}
          </Text>
        </View>
      </View>

      {/* App Tour's `plannerWeekOverview` step — WardrobeScreen's tour
          navigates here (navigation.navigate('Planner')) before
          spotlighting this, same as StylistScreen's own `stylistHeader`.
          Wraps the hero card ("N of 7 days planned") together with the
          day-of-week strip right below it as ONE spotlighted block, since
          together they ARE "the weekly planner" the tooltip's copy refers
          to — spotlighting just one half would leave the other reading as
          an unexplained, un-dimmed gap next to it.
          TourTarget wraps a plain, unstyled View — NOT `heroCard` or the
          day-row directly — deliberately: `heroCard` carries its own
          `marginBottom`, and the day-row's ScrollView carries its own
          negative `marginHorizontal` (`carouselBleed`, bleeding it to the
          true screen edges). Per the established rule (see AppTour.js's
          own TourTarget comment), a DIRECT child's margin inflates an
          auto-sized TourTarget's own measured box — putting an unstyled
          wrapper between them means those margins only ever affect ITS
          box (correctly — the gap between hero and day-row, and the
          day-row's real bled-to-edge width, both genuinely belong inside
          this spotlighted group), never bleed past the group into
          `planLabel`/the plan grid below. */}
      <TourTarget id="plannerWeekOverview" borderRadius={radius.cardLg}>
        <View>
          <View style={styles.heroCard}>
            <View style={styles.heroBlob} />
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{t('planner.heroBadge')}</Text>
            </View>
            <Text style={styles.heroTitle}>{t('planner.heroTitle', { count: plannedDaysCount })}</Text>
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
              style={styles.carouselBleed}
              contentContainerStyle={styles.dayRow}
            >
              {days.map((date) => {
                const dateKey = toDateKey(date);
                const isSelected = dateKey === selectedKey;
                // Freemium cap now limits how many days can be PLANNED, not
                // which pills can be tapped — every day is a real, open
                // navigation target regardless of tier (see canPlanSelectedDay
                // for where the actual limit is enforced instead). The small
                // dot is purely informational: "this day already has a plan",
                // not a lock — helps orient which of the 7 days to check
                // without tapping through each one now that "Your plan" below
                // only ever shows the ONE currently-selected day.
                const isPlanned = !!scheduledOutfits[dateKey];
                return (
                  <TouchableOpacity
                    key={dateKey}
                    style={[styles.dayPill, isSelected && styles.dayPillSelected]}
                    onPress={() => handleSelectDay(date)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.dayPillLabel, isSelected && styles.dayPillLabelSelected]}>
                      {dateKey === todayKey ? t('planner.today') : formatWeekdayShort(date)}
                    </Text>
                    <Text style={[styles.dayPillDate, isSelected && styles.dayPillLabelSelected]}>
                      {date.getDate()}
                    </Text>
                    {isPlanned && (
                      <View style={[styles.dayPillPlannedDot, isSelected && styles.dayPillPlannedDotSelected]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </TourTarget>

      <Text style={styles.planLabel}>{t('planner.yourPlan')}</Text>

      {/* "Your plan" now shows exactly ONE card: whichever day is selected
          above, never every planned day at once (that was the actual bug —
          tapping a day pill visibly re-highlighted it but this section kept
          rendering the full week's worth of cards regardless). */}
      {showLoading ? (
        <View style={[styles.planCardFull, styles.planCardSkeleton]}>
          <Skeleton width={72} height={20} borderRadius={radius.pill} />
          <Skeleton width="70%" height={18} style={{ marginTop: spacing.md }} />
          <Skeleton width="40%" height={12} style={{ marginTop: spacing.xs }} />
        </View>
      ) : selectedEntry ? (
        <View
          style={[
            styles.planCardFull,
            {
              backgroundColor: cardTints[selectedTint],
              borderColor: cardTints[`${selectedTint}Border`],
            },
          ]}
        >
          <View style={styles.planCardHeaderRow}>
            <View style={styles.planCardBadge}>
              <Text style={styles.planCardBadgeText}>
                {selectedKey === todayKey ? t('planner.today') : formatWeekdayShort(selectedDate)}
              </Text>
            </View>
            {/* Export to Calendar — the whole point of this redesign's 3rd
                task: a client shouldn't have to go hunting for this, it sits
                right on the card it acts on. */}
            <TouchableOpacity
              style={styles.exportBtn}
              onPress={handleExportPress}
              activeOpacity={0.8}
              disabled={exporting}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="calendar" size={13} color={colors.textPrimary} />
              <Text style={styles.exportBtnText}>{t('planner.exportToCalendar')}</Text>
            </TouchableOpacity>
          </View>

          <View>
            <Text style={styles.planCardTitle} numberOfLines={2}>
              {summarizeOutfit(selectedEntry, wardrobeById) || t('planner.plannedLook')}
            </Text>
            <Text style={styles.planCardCaption}>{formatWeekdayShortWithDate(selectedDate)}</Text>
          </View>

          <View style={styles.planCardFooterRow}>
            <Text style={styles.planCardFooter}>{t('planner.styledByAi')}</Text>
            <TouchableOpacity
              onPress={() => handleRemove(selectedKey)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="trash-2" size={15} color={colors.textPrimary} style={styles.planCardRemoveIcon} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.plannerEmptyStateCard}>
          <View style={styles.emptyStateIconWrap}>
            <Feather name="calendar" size={26} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyStateText}>
            {t('planner.emptyStateForDay', {
              date: selectedKey === todayKey ? t('planner.today') : formatWeekdayLong(selectedDate),
            })}
          </Text>
          <TouchableOpacity style={styles.planOutfitBtn} onPress={handlePlanPress} activeOpacity={0.85}>
            <Feather name="plus" size={15} color={colors.inverseText} />
            <Text style={styles.planOutfitBtnText}>{t('planner.planOutfitCta')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.surpriseLink} onPress={handleShufflePress} activeOpacity={0.7}>
            <Feather name="shuffle" size={13} color={colors.textSecondary} />
            <Text style={styles.surpriseLinkText}>{t('planner.surpriseMeCta')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {dialogProps && (
        <ConfirmDialog visible onClose={closeDialog} onConfirm={handleConfirm} {...dialogProps} />
      )}
      <PaywallModal visible={!!paywallMessage} message={paywallMessage} onClose={closePaywall} />
      <CalendarPickerModal
        visible={pickerVisible}
        calendars={pickerCalendars}
        onSelect={onSelectCalendar}
        onClose={onDismissPicker}
      />
      <Toast key={toastKey} message={toastMessage} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // ScreenContainer already handles flex:1, background, safe-area top
  // inset, and the strict 16px horizontal margin. paddingTop is set inline
  // above, from a fixed post-safe-area gap.
  content: { paddingBottom: spacing.xl },

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

  // Coral, not violet — matches the per-tab accent (violet=Closet,
  // coral=Planner, sky=Stylist, sage=Profile) the redesign gives each
  // section, so the Planner hero reads as "this tab's own color."
  heroCard: {
    backgroundColor: cardTints.coral,
    borderWidth: 1,
    borderColor: cardTints.coralBorder,
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
    backgroundColor: cardTints.coralBlob,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginBottom: spacing.xs,
  },
  heroBadgeText: { fontSize: 10.5, fontWeight: '700', color: cardTints.coralInk },
  heroTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: 4, maxWidth: '78%' },
  heroCaption: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  // Bleeds the real (non-loading) row to the true screen edge on scroll —
  // see WardrobeScreen's carouselBleed comment for the full mechanic.
  // `flexDirection: 'row'` matters for the OTHER use of this style too: the
  // loading branch reuses it as a plain View's own style, not a
  // ScrollView's contentContainerStyle — a bare View defaults to column, so
  // without this the skeleton day pills stacked vertically instead of
  // matching the real horizontal row.
  carouselBleed: { marginHorizontal: -spacing.screenH },
  dayRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.screenH, paddingBottom: spacing.sm },
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
  // Purely informational "this day has a plan" marker — see the day-row's
  // own comment on why this replaced the old lock badge.
  dayPillPlannedDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textSecondary },
  dayPillPlannedDotSelected: { backgroundColor: colors.inverseText },

  planLabel: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm },

  // "Your plan" — full width now (was a 47% grid tile alongside a second
  // card/quickActionsCard): there's only ever ONE of these on screen at a
  // time, for whichever day is selected above.
  planCardFull: {
    width: '100%',
    minHeight: 172,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  planCardSkeleton: { backgroundColor: colors.surface },
  planCardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planCardFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planCardRemoveIcon: { opacity: 0.55 },
  // Export to Calendar — sits in the plan card's own header row, right next
  // to the day badge, so it's visible the instant a client opens a planned
  // day instead of buried in a menu or a separate screen.
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: withAlpha(colors.surface, 0.75),
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  exportBtnText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  // v7 — badge bg matches the mockup's `heroBadgeStyleSmall`
  // (`rgba(255,255,255,0.75)`), not the flat paper background — a
  // translucent white reads consistently across all three tint colors.
  planCardBadge: {
    alignSelf: 'flex-start',
    backgroundColor: withAlpha(colors.surface, 0.75),
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  planCardBadgeText: { fontSize: 10, fontWeight: '700', color: colors.textPrimary },
  planCardTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: 4, lineHeight: 19 },
  planCardCaption: { fontSize: 11, fontWeight: '600', color: colors.textPrimary, opacity: 0.7 },
  planCardFooter: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, opacity: 0.55 },

  // Zero-plan-for-this-day state — same icon-chip + caption pattern as
  // WardrobeCatalogScreen's CategoryEmptyState, for a consistent "nothing
  // here yet" language across tabs. Now the selected day's own empty state
  // (was a whole-week "nothing planned at all" message before) — carries
  // the actual "Plan outfit"/"Surprise me" entry points, since the old
  // always-present quickActionsCard tile is gone (planning is scoped to
  // whichever day is selected now, not a separate generic tile).
  plannerEmptyStateCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptyStateIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyStateText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  planOutfitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  planOutfitBtnText: { fontSize: 14, fontWeight: '700', color: colors.inverseText },
  surpriseLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  surpriseLinkText: { fontSize: 12.5, fontWeight: '600', color: colors.textSecondary },
});
