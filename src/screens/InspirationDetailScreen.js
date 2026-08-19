import { useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { useUserStore } from '../store/useUserStore';
import { toDateKey } from '../store/usePlannerStore';
import { formatWeekdayLong } from '../utils/dateFormat';
import { triggerHaptic } from '../utils/haptics';
import { colors, cardTints, spacing, radius, shadows, typography } from '../theme/tokens';
import GeneratedItemThumb from '../components/GeneratedItemThumb';
import ConfirmDialog from '../components/ConfirmDialog';
import PaywallModal from '../components/PaywallModal';
import CalendarPickerModal from '../components/CalendarPickerModal';
import Toast from '../components/Toast';
import ScreenContainer from '../components/ScreenContainer';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { usePaywall } from '../hooks/usePaywall';
import { useCalendarPicker } from '../hooks/useCalendarPicker';
import {
  getAvailableCalendars,
  exportOutfitToCalendar,
  CalendarPermissionDeniedError,
} from '../services/calendarService';
import { exportToGoogleCalendar, isNotConnectedError } from '../services/googleCalendarService';
import { buildOutfitIcs, downloadIcs } from '../utils/icsExport';
import { CALENDAR_EXPORT_ENABLED } from '../constants/featureFlags';

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };
const THUMB_SIZE = 64;

// Item 3's detail view: opened by tapping a Lookbook card in WardrobeScreen
// (navigation.navigate('InspirationDetail', { inspirationId, inspiration })).
// `inspirationId` is the authoritative param — this screen re-resolves the
// live row from useWardrobeStore's `inspirations` by id (same "route param
// is just a first-render fallback, the store is truth" pattern
// ItemDetailScreen already uses for `routeItem`/`item`), so a delete that
// happens elsewhere (e.g. the trash button on the card itself, without ever
// opening this screen) can't leave a stale detail view open on a row that no
// longer exists — see the not-found branch below.
export default function InspirationDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const inspirationId = route.params?.inspirationId;
  const routeInspiration = route.params?.inspiration;

  const inspiration =
    useWardrobeStore((state) => state.inspirations.find((i) => i.id === inspirationId)) || routeInspiration;
  // Selects the stable `items` array reference (only changes when the
  // wardrobe actually changes) and derives the lookup map in a `useMemo` —
  // NOT inline inside the Zustand selector itself. A selector that builds a
  // fresh object every call (e.g. `Object.fromEntries(...)` run inline)
  // never returns a stable snapshot, which trips `useSyncExternalStore`'s
  // infinite-loop guard ("Maximum update depth exceeded") since React can
  // never tell the snapshot hasn't changed. Same pattern StylistScreen.js
  // already uses for its own `wardrobeById`.
  const wardrobe = useWardrobeStore((state) => state.items);
  const wardrobeById = useMemo(() => Object.fromEntries(wardrobe.map((item) => [item.id, item])), [wardrobe]);
  const removeInspiration = useWardrobeStore((state) => state.removeInspiration);
  const isPro = useUserStore((state) => state.isPro);
  const googleCalendarConnected = useUserStore((state) => state.googleCalendarConnected);
  const { confirm, dialogProps, closeDialog, handleConfirm } = useConfirm();
  const { toastMessage, toastKey, showToast } = useToast();
  const { paywallMessage, showPaywall, closePaywall } = usePaywall();
  const { pickCalendar, pickerVisible, pickerCalendars, onSelectCalendar, onDismissPicker } =
    useCalendarPicker();

  const [isDeleting, setIsDeleting] = useState(false);
  // Export-to-Calendar's own day-picker — separate from the delete
  // ConfirmDialog's `dialogProps` above, since this is a plain Modal (a
  // 7-day list, same shape StylistScreen's own Save-to-Planner button
  // already uses), not a confirm/cancel dialog.
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 'auto' (Google if connected, else .ics — same default handleExportPress
  // used before this dual path existed) vs 'ics' (always downloads a file,
  // even when Google is connected — the always-available option the
  // separate "Скачать .ics" button below sets explicitly). Only meaningful
  // on web; native ignores it entirely and always uses the device picker.
  const [exportMode, setExportMode] = useState('auto');

  async function performDelete() {
    setIsDeleting(true);
    // removeInspiration is optimistic-with-rollback (see
    // useWardrobeStore) — never throws; a failed delete surfaces as
    // `error` in the store instead, same convention ItemDetailScreen's
    // own handleDeletePress follows for removeItem.
    await removeInspiration(inspiration.id);
    setIsDeleting(false);

    const syncError = useWardrobeStore.getState().error;
    if (syncError) {
      showToast(syncError);
      return;
    }
    navigation.goBack();
  }

  function handleDeletePress() {
    triggerHaptic();
    // useConfirm() routes to the real OS Alert on native and to a
    // CenteredModal-based dialog on web (see that hook's own comment) —
    // `Alert.alert` alone is a silent no-op in react-native-web, which
    // would otherwise make this button do nothing at all for a web client.
    confirm({
      title: t('closet.inspirations.deleteTitle'),
      message: t('closet.inspirations.deleteMessage'),
      cancelLabel: t('itemDetail.deleteCancel'),
      confirmLabel: t('itemDetail.deleteConfirm'),
      onConfirm: performDelete,
    });
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: t('closet.inspirationDetail.title'),
      headerRight: () => (
        <View style={styles.headerActions}>
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <TouchableOpacity onPress={handleDeletePress} hitSlop={HIT_SLOP} style={styles.headerIconBtn}>
              <Feather name="trash-2" size={18} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, t, isDeleting, inspiration?.id]);

  if (!inspiration) {
    return (
      <ScreenContainer edges={['bottom']} scroll={false} contentStyle={styles.notFoundContainer}>
        <Text style={styles.notFoundText}>{t('closet.inspirationDetail.notFound')}</Text>
      </ScreenContainer>
    );
  }

  const items = inspiration.generatedItems || [];

  // Pro-only — mirrors WardrobeScreen's Shopping Copilot gate exactly:
  // `isPro` decides between opening the real day-picker and just showing
  // the paywall, checked BEFORE ever touching expo-calendar (no OS
  // permission prompt for a feature a free client can't use anyway).
  function handleExportPress() {
    triggerHaptic();
    if (!isPro) {
      showPaywall(t('paywall.calendarExportMessage'));
      return;
    }
    setExportMode('auto');
    setExportModalVisible(true);
  }

  // Always available on web regardless of Google Calendar connection state
  // — same "give Apple Calendar/Outlook/anyone else a real option too"
  // reasoning as PlannerScreen's own always-visible .ics link, just routed
  // through this screen's existing day-picker instead of a second button,
  // since a saved Lookbook look has no date of its own until one is picked.
  function handleDownloadIcsPress() {
    triggerHaptic();
    if (!isPro) {
      showPaywall(t('paywall.calendarExportMessage'));
      return;
    }
    setExportMode('ics');
    setExportModalVisible(true);
  }

  async function handleSelectExportDay(date) {
    if (exporting) return;
    // Closes the day picker right away rather than leaving it stacked
    // behind the calendar picker that comes next — the two are sequential
    // steps of one flow, not layers meant to be visible together.
    setExportModalVisible(false);
    setExporting(true);
    try {
      const itemNames = items.map((entry) => entry.name).filter(Boolean);

      if (Platform.OS === 'web') {
        if (exportMode === 'ics' || !googleCalendarConnected) {
          downloadIcs(buildOutfitIcs({ itemNames, date }), `shoom-${toDateKey(date)}.ics`);
          showToast(
            t(
              exportMode === 'ics'
                ? 'closet.inspirationDetail.exportSuccessIcs'
                : 'closet.inspirationDetail.exportNotConnected'
            )
          );
          return;
        }
        try {
          await exportToGoogleCalendar({ itemNames, date });
          showToast(t('closet.inspirationDetail.exportSuccessGoogle'));
        } catch (err) {
          if (isNotConnectedError(err)) {
            downloadIcs(buildOutfitIcs({ itemNames, date }), `shoom-${toDateKey(date)}.ics`);
            showToast(t('closet.inspirationDetail.exportReconnectRequired'));
            return;
          }
          throw err;
        }
        return;
      }

      const calendars = await getAvailableCalendars();
      if (calendars.length === 0) {
        showToast(t('closet.inspirationDetail.exportNoCalendars'));
        return;
      }
      const calendarId = await pickCalendar(calendars);
      if (!calendarId) return; // client backed out of the picker

      await exportOutfitToCalendar({ itemNames, date, calendarId });
      showToast(t('closet.inspirationDetail.exportSuccessGoogle'));
    } catch (err) {
      // CalendarPermissionDeniedError gets its own translated copy (denied-
      // permission clients need the Settings pointer, not a raw OS error
      // string) — anything else falls back to whatever the OS/expo-calendar
      // actually said, same convention ScanSheet's own save-error handling
      // already follows.
      if (err instanceof CalendarPermissionDeniedError) {
        showToast(t('closet.inspirationDetail.exportPermissionDenied'));
      } else {
        console.error('[InspirationDetailScreen] Calendar export failed:', err);
        showToast(err.message || t('closet.inspirationDetail.exportGenericError'));
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScreenContainer edges={['bottom']} scroll={false}>
      <ScrollView style={styles.flexFill} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.aiText}>{inspiration.aiText}</Text>

        {/* Hidden behind CALENDAR_EXPORT_ENABLED (Google verification
            pending, Apple has no OAuth at all — see that flag's own
            comment), but left fully wired rather than deleted so flipping
            it back on is the only step needed later. */}
        {CALENDAR_EXPORT_ENABLED && (
        <View style={styles.exportBtnRow}>
          <TouchableOpacity style={styles.exportBtn} onPress={handleExportPress} activeOpacity={0.8}>
            <Feather name="calendar" size={14} color={colors.textPrimary} />
            <Text style={styles.exportBtnText}>{t('closet.inspirationDetail.exportToCalendar')}</Text>
          </TouchableOpacity>
          {Platform.OS === 'web' && (
            <TouchableOpacity onPress={handleDownloadIcsPress} activeOpacity={0.7} hitSlop={HIT_SLOP}>
              <Text style={styles.exportIcsLinkText}>{t('closet.inspirationDetail.downloadIcs')}</Text>
            </TouchableOpacity>
          )}
        </View>
        )}

        <Text style={styles.itemsHeading}>{t('closet.inspirationDetail.itemsHeading')}</Text>

        {items.map((entry, index) => {
          // Real wardrobe items get a live link to their own detail screen
          // (tappable, chevron shown) when the item is still in the closet
          // — the saved snapshot itself only ever carries {type, id, name,
          // imageUrl}, so this re-resolves the live row rather than
          // trusting a stale one. A "new" (AI-suggested) item has no `id`
          // at all — nothing to link to, so it renders as a plain,
          // non-pressable card (see GeneratedItemThumb's own placeholder
          // for the missing photo).
          const liveItem = entry.type === 'wardrobe' ? wardrobeById[entry.id] : null;
          const isFromCloset = entry.type === 'wardrobe';

          return (
            <TouchableOpacity
              key={`${entry.name}-${index}`}
              style={styles.itemRow}
              activeOpacity={liveItem ? 0.7 : 1}
              disabled={!liveItem}
              onPress={() => liveItem && navigation.navigate('ItemDetail', { item: liveItem })}
            >
              <GeneratedItemThumb uri={entry.imageUrl} name={entry.name} style={styles.itemThumb} />
              <View style={styles.itemTextWrap}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {entry.name}
                </Text>
                <View style={[styles.itemBadge, isFromCloset ? styles.itemBadgeCloset : styles.itemBadgeSuggested]}>
                  <Text
                    style={[
                      styles.itemBadgeText,
                      isFromCloset ? styles.itemBadgeTextCloset : styles.itemBadgeTextSuggested,
                    ]}
                  >
                    {isFromCloset
                      ? t('closet.inspirationDetail.fromCloset')
                      : t('closet.inspirationDetail.suggested')}
                  </Text>
                </View>
              </View>
              {liveItem && <Feather name="chevron-right" size={18} color={colors.textMuted} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {dialogProps && (
        <ConfirmDialog visible onClose={closeDialog} onConfirm={handleConfirm} {...dialogProps} />
      )}
      <CalendarExportModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        onSelectDay={handleSelectExportDay}
      />
      <CalendarPickerModal
        visible={pickerVisible}
        calendars={pickerCalendars}
        onSelect={onSelectCalendar}
        onClose={onDismissPicker}
      />
      <PaywallModal visible={!!paywallMessage} message={paywallMessage} onClose={closePaywall} />
      <Toast key={toastKey} message={toastMessage} />
    </ScreenContainer>
  );
}

// 7-day picker for Export to Calendar — same shape as StylistScreen's own
// Save-to-Planner modal (a plain day list, not a full native date wheel):
// this app's exports are always "put this look on one of the next 7 days",
// never an arbitrary future date, so that's the only range worth offering.
function CalendarExportModal({ visible, onClose, onSelectDay }) {
  const { t } = useTranslation();

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      return date;
    });
  }, []);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.exportBackdrop} onPress={onClose}>
        <Pressable style={styles.exportSheet} onPress={() => {}}>
          <Text style={styles.exportSheetTitle}>{t('closet.inspirationDetail.exportModalTitle')}</Text>
          {days.map((date) => (
            <TouchableOpacity
              key={toDateKey(date)}
              style={styles.exportDayRow}
              onPress={() => onSelectDay(date)}
              activeOpacity={0.7}
            >
              <Text style={styles.exportDayRowText}>{formatWeekdayLong(date)}</Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  aiText: {
    ...typography.body,
    marginBottom: spacing.md,
  },

  // Export to Calendar — a secondary pill action (same shape/weight as
  // StylistScreen's own saveToPlannerBtn), sitting between the AI text and
  // the items list rather than in the header: it acts on the whole look,
  // same altitude as the (also whole-look) delete action already in the
  // header, but reads better as an in-content CTA than a second header icon.
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    ...shadows.sm,
  },
  exportBtnText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  exportBtnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  exportIcsLinkText: { fontSize: 11.5, fontWeight: '600', color: colors.textSecondary, textDecorationLine: 'underline' },

  itemsHeading: { ...typography.label, marginBottom: spacing.sm },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xs,
    marginBottom: spacing.sm,
    ...shadows.soft,
  },
  itemThumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: radius.sm },
  itemTextWrap: { flex: 1, gap: 2 },
  itemName: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  itemBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    marginTop: 2,
  },
  itemBadgeCloset: { backgroundColor: cardTints.sage },
  itemBadgeSuggested: { backgroundColor: cardTints.violet },
  itemBadgeText: { fontSize: 10, fontWeight: '700' },
  itemBadgeTextCloset: { color: colors.sage },
  itemBadgeTextSuggested: { color: colors.violet },

  // No `paddingRight` here (there used to be one) — native-stack already
  // applies its own standard horizontal inset around `headerRight`, matching
  // the back button's own inset on the left. Adding more on top of that was
  // exactly what made the trash icon read as off-center/misaligned relative
  // to the title and the header's other edge.
  //
  // `height` + `justifyContent: 'center'` added on top of that — Android's
  // (Chromium) WebView measured this row at its own content height (32px,
  // headerIconBtn's own size) instead of matching the native-stack header
  // bar's real height the way iOS's WKWebView did, so `alignItems: 'center'`
  // alone centered the icon within a box that was already the wrong height
  // and top-aligned within the actual header row — read as the icon
  // floating high/clipped near the status bar. An explicit height matching
  // the standard header content height removes that platform-dependent
  // measurement from the equation entirely.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    gap: spacing.md,
  },
  // Explicit square, centered hit area with its OWN circular chip
  // background — not just `padding`, and not relying on any background a
  // parent/native header container might already be drawing. A plain
  // `padding` box's visual center can drift from the glyph's own bounding
  // box depending on the icon's exact metrics; giving this button its own
  // fully-owned `width`/`height`/`borderRadius`/centering means the icon is
  // guaranteed dead-center inside ITS OWN chip regardless of what else is
  // rendered around it.
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  notFoundContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  notFoundText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },

  // CalendarExportModal — identical shape to StylistScreen's own
  // plannerBackdrop/plannerSheet/plannerDayRow (duplicated rather than
  // shared, same reasoning as that screen's own authPromptWrap: a small,
  // screen-local style block not worth a shared component for two users).
  exportBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  exportSheet: {
    backgroundColor: colors.premiumBackground,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    ...shadows.soft,
  },
  exportSheetTitle: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  exportDayRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  exportDayRowText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
});
