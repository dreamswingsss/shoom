import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  StyleSheet,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography, withAlpha } from '../theme/tokens';
import { CATEGORIES } from '../constants/wardrobeOptions';
import Skeleton from '../components/Skeleton';
import HorizontalFadeScroll from '../components/HorizontalFadeScroll';
import ScreenContainer from '../components/ScreenContainer';

// 3 rows x 2 columns — enough to fill the screen below the header without
// looking sparse, without the (harmless, but pointless) cost of animating
// dozens of shimmer views at once.
const SKELETON_ROW_COUNT = 3;
const GRID_COLUMNS = 2;

// First-load entrance — cards fade/slide in once, the instant real data (or
// the empty state) is ready. Separate from LayoutAnimation below, which
// handles the grid reflowing on every category switch instead.
const ENTRANCE_DURATION = 420;
const ENTRANCE_TRANSLATE_Y = 16;

// 'All' isn't a real category (CATEGORIES is the shared source of truth
// used by the scan flow and the AI stylist prompt too) — it's prepended
// here, filter-only, so the chip row always leads with "show everything".
const FILTERS = ['All', ...CATEGORIES];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Groups items into pairs for the 2-up grid.
function chunkIntoRows(items, columns) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

export default function WardrobeCatalogScreen({ wardrobe, loading, onBack, onAddItem }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredItems = useMemo(
    () => (activeCategory === 'All' ? wardrobe : wardrobe.filter((item) => item.category === activeCategory)),
    [wardrobe, activeCategory]
  );
  const rows = useMemo(() => chunkIntoRows(filteredItems, GRID_COLUMNS), [filteredItems]);

  // Closet's fetchWardrobe() usually resolves well before the client taps
  // into Catalog (it fires on the Hub's mount), but this covers the rare
  // case they get here first — an empty grid with no explanation would
  // otherwise look identical to "you own nothing yet".
  const showLoading = loading && wardrobe.length === 0;

  // Runs exactly once, on mount — NOT on every category switch (that's
  // handleSelectCategory's LayoutAnimation below), so filtering never
  // re-triggers a fade from zero.
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceTranslateY = useRef(new Animated.Value(ENTRANCE_TRANSLATE_Y)).current;
  useEffect(() => {
    Animated.timing(entranceOpacity, {
      toValue: 1,
      duration: ENTRANCE_DURATION,
      useNativeDriver: true,
    }).start();
    Animated.timing(entranceTranslateY, {
      toValue: 0,
      duration: ENTRANCE_DURATION,
      useNativeDriver: true,
    }).start();
  }, []);

  function handleSelectCategory(category) {
    if (category === activeCategory) return;
    // Animates the grid reflowing (cards sliding together/apart) as items
    // enter/leave the filtered set — configured on the native side right
    // before the state change it's animating, per LayoutAnimation's contract.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveCategory(category);
  }

  return (
    // edges=['top'] — this replaces WardrobeScreen's own body in place
    // (still the Closet tab, still sitting above TabNavigator's floating
    // bar), same as WardrobeScreen's own root.
    <ScreenContainer edges={['top']} scroll={false} contentStyle={styles.topGap}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('closet.catalog.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <HorizontalFadeScroll
        fadeColor={colors.background}
        style={styles.carouselBleed}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((category) => {
          const isActive = category === activeCategory;
          return (
            <TouchableOpacity
              key={category}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => handleSelectCategory(category)}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                {category === 'All' ? t('closet.catalog.allFilter') : t(`closet.categories.${category}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </HorizontalFadeScroll>

      {showLoading ? (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
            <View key={rowIndex} style={styles.row}>
              <GridCardSkeleton />
              <GridCardSkeleton />
            </View>
          ))}
        </ScrollView>
      ) : filteredItems.length === 0 ? (
        <Animated.View
          style={[styles.gridWrap, { opacity: entranceOpacity, transform: [{ translateY: entranceTranslateY }] }]}
        >
          <CategoryEmptyState category={activeCategory} onAddItem={onAddItem} />
        </Animated.View>
      ) : (
        <Animated.View
          style={[styles.gridWrap, { opacity: entranceOpacity, transform: [{ translateY: entranceTranslateY }] }]}
        >
          <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {row.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.gridCard}
                    activeOpacity={0.8}
                    onPress={() => navigation.navigate('ItemDetail', { item })}
                  >
                    <Image source={{ uri: item.imageUri }} style={styles.gridImage} />
                    <Text style={styles.gridSubcategory} numberOfLines={1}>
                      {item.subcategory}
                    </Text>
                    <Text style={styles.gridColor} numberOfLines={1}>
                      {item.color}
                    </Text>
                    <View style={styles.wornBadge}>
                      <Feather name="eye" size={11} color={colors.textMuted} />
                      <Text style={styles.wornBadgeText}>
                        {t('closet.catalog.wornCount', { count: item.wornCount || 0 })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {row.length === 1 && <View style={styles.gridCardSpacer} />}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      )}
    </ScreenContainer>
  );
}

// Mirrors a real gridCard's layout exactly (square image, two text lines,
// a small badge line) — reusing gridCard's own spacing so the skeleton grid
// and the real grid line up pixel-for-pixel once the swap happens.
function GridCardSkeleton() {
  return (
    <View style={styles.gridCard}>
      <Skeleton style={styles.skeletonImage} borderRadius={radius.sm} />
      <Skeleton width="80%" height={12} style={styles.skeletonLineGap} />
      <Skeleton width="45%" height={11} style={styles.skeletonLineGapSmall} />
      <Skeleton width={64} height={10} style={styles.skeletonLineGapSmall} />
    </View>
  );
}

// Shown instead of a bare blank grid when the active filter has zero items —
// "All" gets the generic empty-closet copy, any real category gets its own
// named copy ("No {{category}} yet"). The ENTIRE dashed card is the tap
// target (not just a small CTA button inside it) — `onAddItem` fires from
// the outer TouchableOpacity, with `minHeight: 200` guaranteeing a large hit
// area even when the icon+text content itself is shorter than that. Styled
// as an inviting call-to-action (dashed border, tinted fill, a big
// translucent hanger, a muted "Tap to add" hint) rather than a plain white
// card — this is often the FIRST thing a client sees after a category has
// been sitting empty, so it should read as "tap anywhere here to fix that",
// not just as a passive placeholder with one small hotspot inside it.
function CategoryEmptyState({ category, onAddItem }) {
  const { t } = useTranslation();
  const label =
    category === 'All'
      ? t('closet.catalog.emptyCategory')
      : t('closet.catalog.emptyCategoryNamed', { category: t(`closet.categories.${category}`) });

  return (
    <View style={styles.emptyStateWrap}>
      <TouchableOpacity style={styles.emptyStateCard} onPress={onAddItem} activeOpacity={0.7}>
        <MaterialCommunityIcons
          name="hanger"
          size={64}
          color={withAlpha(colors.accent, 0.3)}
          style={styles.emptyStateIcon}
        />
        <Text style={styles.emptyStateText}>{label}</Text>
        <Text style={styles.emptyStateHint}>{t('closet.catalog.emptyHint')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // ScreenContainer already handles flex:1, background, safe-area top inset,
  // and the strict 16px horizontal margin — this is just the extra
  // breathing room below the inset the old `insets.top + spacing.sm` calc
  // used to add on top of it.
  topGap: { paddingTop: spacing.sm },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.title },

  // Category filter chips — bleeds to the true screen edge on scroll
  // instead of stopping at an invisible 16px wall (see WardrobeScreen's own
  // carouselBleed comment for the full mechanic).
  carouselBleed: { marginHorizontal: -spacing.screenH },
  filterRow: {
    gap: spacing.xs,
    paddingHorizontal: spacing.screenH,
    paddingBottom: spacing.sm,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    // `minHeight` (not just paddingVertical) guarantees a >=44pt tap target
    // regardless of the label's actual line-height.
    minHeight: 44,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  filterChipTextActive: { color: colors.inverseText },

  gridWrap: { flex: 1 },
  listContent: { paddingBottom: spacing.xl },

  // Skeleton grid — skeletonImage matches gridImage's own size/radius
  // exactly (minus its backgroundColor, which Skeleton always overrides —
  // see its own comment on why that's deliberate).
  skeletonImage: {
    width: '100%',
    aspectRatio: 1,
    marginBottom: spacing.xs,
  },
  skeletonLineGap: { marginTop: 2 },
  skeletonLineGapSmall: { marginTop: 4 },

  // Empty state — a dashed, tinted "drop zone" rather than the old solid
  // glassCard box, so an empty filter reads as an invitation to add
  // something, not just a passive placeholder. `cardTints.violet` under a
  // dashed `colors.accent` border (both already used elsewhere for the
  // same violet accent, see theme/tokens.js) instead of a plain surface fill.
  emptyStateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  // The whole card is the TouchableOpacity (see CategoryEmptyState) —
  // `minHeight` guarantees a generous tap target regardless of how short
  // the icon+text content ends up being, instead of relying on padding
  // alone to size the hit area.
  emptyStateCard: {
    width: '100%',
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accent, 0.06),
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: withAlpha(colors.accent, 0.35),
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyStateIcon: { marginBottom: spacing.sm },
  emptyStateText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Passive hint, not a button — the whole card is already tappable, so
  // this just labels the affordance instead of being its own hotspot.
  emptyStateHint: {
    marginTop: spacing.xs,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.accent,
    textAlign: 'center',
  },

  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  gridCard: { flex: 1 },
  gridCardSpacer: { flex: 1 },
  gridImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    marginBottom: spacing.xs,
  },
  gridSubcategory: {
    fontFamily: typography.title.fontFamily,
    fontWeight: '600',
    fontSize: 12,
    color: colors.textPrimary,
  },
  gridColor: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  wornBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  wornBadgeText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
});
