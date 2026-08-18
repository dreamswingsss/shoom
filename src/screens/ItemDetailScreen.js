import { useLayoutEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { toDateKey } from '../store/usePlannerStore';
import { triggerHaptic } from '../utils/haptics';
import { colors, spacing, radius, shadows, buttons, typography, withAlpha } from '../theme/tokens';
import { CATEGORIES, COLOR_OPTIONS } from '../constants/wardrobeOptions';
import { ChipPicker } from '../components/ChipPicker';
import ScreenContainer from '../components/ScreenContainer';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { agreeColorWithNoun } from '../utils/colorAgreement';

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export default function ItemDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const routeItem = route.params?.item;

  const updateItem = useWardrobeStore((state) => state.updateItem);
  const removeItem = useWardrobeStore((state) => state.removeItem);
  const incrementWornCount = useWardrobeStore((state) => state.incrementWornCount);

  // Reads the live item from the store (by id) rather than trusting the
  // route param snapshot — keeps the screen in sync with itself after
  // "I'm wearing this today" / inline edit, both of which mutate the store.
  // Falls back to the snapshot only for the first render before the store
  // subscription resolves.
  const item = useWardrobeStore((state) => state.items.find((i) => i.id === routeItem?.id)) || routeItem;

  const [isEditing, setIsEditing] = useState(false);
  const [draftCategory, setDraftCategory] = useState(item?.category);
  const [draftColor, setDraftColor] = useState(item?.color);
  const [isDeleting, setIsDeleting] = useState(false);
  const { confirm, dialogProps, closeDialog, handleConfirm } = useConfirm();
  const { toastMessage, toastKey, showToast } = useToast();

  function handleEditPress() {
    triggerHaptic();
    setDraftCategory(item.category);
    setDraftColor(item.color);
    setIsEditing(true);
  }

  function handleEditCancel() {
    triggerHaptic();
    setIsEditing(false);
  }

  function handleEditSave() {
    triggerHaptic();
    updateItem(item.id, { category: draftCategory, color: draftColor });
    setIsEditing(false);
  }

  async function performDelete() {
    setIsDeleting(true);
    // removeItem is optimistic-with-rollback (see useWardrobeStore) — it
    // never throws, so a failed delete/Storage call surfaces as `error` in
    // the store instead. Deleting is destructive AND navigates away, so —
    // unlike the fire-and-forget wear/edit actions below — this is the one
    // action worth confirming actually succeeded before leaving the screen;
    // otherwise a failed network call would silently leave the item intact
    // while the client already navigated off believing it was gone.
    await removeItem(item.id);
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
      title: t('itemDetail.deleteTitle'),
      message: t('itemDetail.deleteMessage'),
      cancelLabel: t('itemDetail.deleteCancel'),
      confirmLabel: t('itemDetail.deleteConfirm'),
      onConfirm: performDelete,
    });
  }

  useLayoutEffect(() => {
    if (!item) return;
    navigation.setOptions({
      headerTitle: t(`closet.categories.${item.category}`),
      headerRight: () => (
        <View style={styles.headerActions}>
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <TouchableOpacity onPress={handleEditPress} hitSlop={HIT_SLOP} style={styles.headerIconBtn}>
                <Feather name="edit-2" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeletePress} hitSlop={HIT_SLOP} style={styles.headerIconBtn}>
                <Feather name="trash-2" size={18} color={colors.danger} />
              </TouchableOpacity>
            </>
          )}
        </View>
      ),
    });
  }, [navigation, item?.id, item?.category, t, isDeleting]);

  if (!item) {
    return (
      // edges=['bottom'] only — native-stack's own header already reserves
      // the top safe-area inset for this screen; only the home-indicator
      // clearance at the bottom is this component's own responsibility.
      <ScreenContainer edges={['bottom']} scroll={false} contentStyle={styles.notFoundContainer}>
        <Text style={styles.notFoundText}>{t('itemDetail.notFound')}</Text>
      </ScreenContainer>
    );
  }

  // Once per local calendar day — mirrors the guard useWardrobeStore's
  // incrementWornCount() and the increment_worn_count() RPC both enforce,
  // just for the button's own disabled/label state.
  const today = toDateKey(new Date());
  const wornToday = item.lastWornDate === today;

  function handleWearToday() {
    if (wornToday) return;
    triggerHaptic();
    incrementWornCount(item.id);
  }

  function handleStyleThis() {
    triggerHaptic();
    // Hands the exact item off via a route param (`targetItem`) rather than
    // the chat store's pendingPrompt — StylistScreen watches this param and
    // sends the "Build an outfit around my..." prompt itself on mount.
    // ItemDetailScreen sits on the root Stack (a sibling of the "Main" tab
    // navigator, not nested inside it), so reaching a specific tab needs the
    // nested `{ screen, params }` form rather than a flat `navigate(...)`.
    navigation.navigate('Main', { screen: 'AI Stylist', params: { targetItem: item } });
  }

  const wornCount = item.wornCount || 0;

  return (
    // edges=['bottom'] only — see the not-found branch above for why.
    // scroll=false + our own ScrollView (rather than ScreenContainer's
    // built-in one) is what lets `photo` sit as its own full-bleed child,
    // outside the 16px margin `detailPad` applies to everything below it —
    // ScreenContainer's own content box would otherwise inset the image too.
    <ScreenContainer edges={['bottom']} scroll={false} contentStyle={styles.zeroHPadding}>
      <ScrollView style={styles.flexFill} contentContainerStyle={styles.scrollContent}>
        <Image source={{ uri: item.imageUri }} style={styles.photo} />

        <View style={styles.detailPad}>
          <Text style={styles.title}>
            {agreeColorWithNoun(t(`closet.colors.${item.color}`), item.subcategory)} {item.subcategory}
          </Text>
          <Text style={styles.subtitle}>
            {t(`closet.colors.${item.color}`)} · {t(`closet.categories.${item.category}`)}
          </Text>

          <View style={styles.statPlaque}>
            <View style={styles.statIconWrap}>
              <Feather name="eye" size={16} color={colors.accent} />
            </View>
            <Text style={styles.statText}>{t('closet.catalog.wornCount', { count: wornCount })}</Text>
          </View>

          {isEditing ? (
            <View style={styles.editPanel}>
              <Text style={styles.editLabel}>{t('itemDetail.editCategoryLabel')}</Text>
              <ChipPicker
                options={CATEGORIES}
                value={draftCategory}
                onSelect={setDraftCategory}
                getLabel={(option) => t(`closet.categories.${option}`)}
              />

              <Text style={[styles.editLabel, styles.editLabelSpaced]}>{t('itemDetail.editColorLabel')}</Text>
              <ChipPicker
                options={COLOR_OPTIONS}
                value={draftColor}
                onSelect={setDraftColor}
                getLabel={(option) => t(`closet.colors.${option}`)}
              />

              <View style={styles.editActions}>
                <TouchableOpacity style={styles.editCancelBtn} onPress={handleEditCancel} activeOpacity={0.8}>
                  <Text style={styles.editCancelBtnText}>{t('itemDetail.editCancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editSaveBtn} onPress={handleEditSave} activeOpacity={0.85}>
                  <Text style={styles.editSaveBtnText}>{t('itemDetail.editSave')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.wearTodayBtn, wornToday && styles.wearTodayBtnDone]}
                onPress={handleWearToday}
                disabled={wornToday}
                activeOpacity={0.85}
              >
                <Feather
                  name={wornToday ? 'check' : 'plus-circle'}
                  size={18}
                  color={wornToday ? colors.textSecondary : colors.inverseText}
                />
                <Text style={[styles.wearTodayBtnText, wornToday && styles.wearTodayBtnTextDone]}>
                  {wornToday ? t('itemDetail.wornToday') : t('itemDetail.wearToday')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.styleThisBtn} onPress={handleStyleThis} activeOpacity={0.8}>
                <Feather name="zap" size={16} color={colors.textPrimary} />
                <Text style={styles.styleThisBtnText}>{t('itemDetail.styleThis')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {dialogProps && (
        <ConfirmDialog visible onClose={closeDialog} onConfirm={handleConfirm} {...dialogProps} />
      )}
      <Toast key={toastKey} message={toastMessage} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // Cancels ScreenContainer's own 16px shell padding — `photo` below needs
  // to sit full-bleed against the screen edges; `detailPad` re-applies that
  // same 16px, one layer in, to just the text/actions content beneath it.
  zeroHPadding: { paddingHorizontal: 0 },
  flexFill: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  // Edge-to-edge — no rounding/shadow (both would read as "a card floating
  // on the page", the opposite of a full-bleed hero photo).
  photo: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: colors.surface,
  },
  detailPad: { paddingHorizontal: spacing.screenH },

  title: {
    ...typography.h2,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 4,
  },

  statPlaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.md,
    ...shadows.soft,
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: withAlpha(colors.sky, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  statText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

  actions: { marginTop: spacing.lg, gap: spacing.sm },
  wearTodayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
  },
  wearTodayBtnText: { fontSize: 16, fontWeight: '700', color: colors.inverseText },
  // "Already worn today" state — swaps the Electric Blue fill for the same
  // glass/outline treatment styleThisBtn (the secondary action) uses below,
  // so the button visually reads as "done", not as another live CTA.
  wearTodayBtnDone: { backgroundColor: colors.glassCard, ...shadows.sm },
  wearTodayBtnTextDone: { color: colors.textSecondary },
  styleThisBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.glassCard,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  styleThisBtnText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },

  editPanel: {
    marginTop: spacing.lg,
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    padding: spacing.md,
    ...shadows.soft,
  },
  editLabel: { ...typography.label },
  editLabelSpaced: { marginTop: spacing.md },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  editCancelBtn: { ...buttons.secondary, flex: 1, paddingVertical: spacing.xs },
  editCancelBtnText: { ...buttons.secondaryText, fontSize: 14 },
  editSaveBtn: { ...buttons.primary, flex: 1, paddingVertical: spacing.xs },
  editSaveBtnText: { ...buttons.primaryText, fontSize: 14 },

  headerActions: { flexDirection: 'row', gap: spacing.md, paddingRight: spacing.xs },
  headerIconBtn: { padding: 2 },

  notFoundContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  notFoundText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
});
