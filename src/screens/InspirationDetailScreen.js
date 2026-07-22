import { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { triggerHaptic } from '../utils/haptics';
import { colors, cardTints, spacing, radius, shadows, typography } from '../theme/tokens';
import GeneratedItemThumb from '../components/GeneratedItemThumb';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import ScreenContainer from '../components/ScreenContainer';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';

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
  const { confirm, dialogProps, closeDialog, handleConfirm } = useConfirm();
  const { toastMessage, toastKey, showToast } = useToast();

  const [isDeleting, setIsDeleting] = useState(false);

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

  return (
    <ScreenContainer edges={['bottom']} scroll={false}>
      <ScrollView style={styles.flexFill} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.aiText}>{inspiration.aiText}</Text>

        <Text style={styles.itemsHeading}>{t('closet.inspirationDetail.itemsHeading')}</Text>

        {items.map((entry, index) => {
          // Real wardrobe items get enriched with live data (color/category/
          // description) when the item is still in the closet — the saved
          // snapshot itself only ever carries {type, id, name, imageUrl},
          // never a description, since that's all SaveInspirationButton had
          // to work with at save time (see StylistScreen.js). A "new"
          // (AI-suggested) item never has a description at all — Gemini's
          // own schema only returns name + search_query for those (see
          // aiChatEngine.js's buildSystemPrompt) — so this only ever shows
          // one for the wardrobe case, never a fabricated one.
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
                {liveItem?.description ? (
                  <Text style={styles.itemDescription} numberOfLines={2}>
                    {liveItem.description}
                  </Text>
                ) : null}
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
      <Toast key={toastKey} message={toastMessage} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  aiText: {
    ...typography.body,
    marginBottom: spacing.md,
  },
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
  itemDescription: { fontSize: 12, color: colors.textSecondary },
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

  headerActions: { flexDirection: 'row', gap: spacing.md, paddingRight: spacing.xs },
  headerIconBtn: { padding: 2 },

  notFoundContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  notFoundText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
});
