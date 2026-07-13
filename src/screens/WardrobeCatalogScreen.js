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
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, typography, shadows } from '../theme/tokens';
import { CATEGORIES } from '../constants/wardrobeOptions';
import Skeleton from '../components/Skeleton';

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

export default function WardrobeCatalogScreen({ wardrobe, loading, onBack }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
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
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('closet.catalog.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
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
      </ScrollView>

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
          <CategoryEmptyState category={activeCategory} />
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
    </View>
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
// named copy ("No shoes added yet").
function CategoryEmptyState({ category }) {
  const { t } = useTranslation();
  const label =
    category === 'All'
      ? t('closet.catalog.emptyCategory')
      : t('closet.catalog.emptyCategoryNamed', { category: t(`closet.categories.${category}`) });

  return (
    <View style={styles.emptyStateWrap}>
      <View style={styles.emptyStateCard}>
        <View style={styles.emptyStateIconWrap}>
          <Feather name="shopping-bag" size={26} color={colors.textMuted} />
        </View>
        <Text style={styles.emptyStateText}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // paddingTop set inline above, from real safe-area top inset.
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.sm },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.title },

  // Category filter chips
  filterRow: {
    gap: spacing.xs,
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

  // Empty state — deliberately borrows the Hub's "glassCard" treatment
  // (see theme/tokens.js) rather than this screen's own Quiet Luxury
  // surface/border convention, so an empty filter reads as a soft, elevated
  // placeholder rather than a plain box.
  emptyStateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyStateCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    ...shadows.soft,
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
