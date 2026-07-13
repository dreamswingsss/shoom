const HIDDEN_GEM_THRESHOLD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// "Worn" is derived from Planner history (usePlannerStore's
// `scheduledOutfits`), not a separate manual counter — a day only counts
// as a wear if the client actually scheduled that item for it. `newItems`
// (AI-suggested items to buy) are ignored here; only real wardrobe item
// ids in `outfit.outfitIds` count, since this is about what the client
// actually owns and wears.
//
// Note: this takes `scheduledOutfits` as a second argument even though the
// task described `calculateInsights(wardrobeItems)` as single-arg — wear
// counts can't be computed from the wardrobe list alone, they need the
// planner's scheduling history. Defaults to `{}` so calling it with just
// the wardrobe still returns a well-formed (empty) result instead of
// throwing.
export function calculateInsights(wardrobeItems, scheduledOutfits = {}) {
  if (!Array.isArray(wardrobeItems) || wardrobeItems.length === 0) {
    return { mostWornItem: null, leastWornItem: null, totalValue: 0 };
  }

  const wearCounts = {};
  const lastWornDate = {};

  Object.entries(scheduledOutfits).forEach(([dateKey, outfit]) => {
    const date = new Date(dateKey);
    (outfit?.outfitIds || []).forEach((itemId) => {
      wearCounts[itemId] = (wearCounts[itemId] || 0) + 1;
      if (!lastWornDate[itemId] || date > lastWornDate[itemId]) {
        lastWornDate[itemId] = date;
      }
    });
  });

  let mostWornItem = null;
  let mostWornCount = 0;
  wardrobeItems.forEach((item) => {
    const count = wearCounts[item.id] || 0;
    if (count > mostWornCount) {
      mostWornCount = count;
      mostWornItem = item;
    }
  });

  // "Hidden gem": the item with the longest gap since it was last worn,
  // as long as that gap clears the 30-day bar. An item never scheduled at
  // all has an effectively infinite gap, so it's the first candidate once
  // there's enough planner history to make the comparison meaningful.
  const now = new Date();
  let leastWornItem = null;
  let largestGapDays = HIDDEN_GEM_THRESHOLD_DAYS;
  wardrobeItems.forEach((item) => {
    const last = lastWornDate[item.id];
    const gapDays = last ? Math.floor((now - last) / MS_PER_DAY) : Infinity;
    if (gapDays > largestGapDays) {
      largestGapDays = gapDays;
      leastWornItem = item;
    }
  });

  // Optional — only meaningful once wardrobe items carry a `price` field,
  // which nothing in the scan/confirm flow collects yet. Sums to 0 until
  // that field exists; kept here so the shape is ready for when it does.
  const totalValue = wardrobeItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  return { mostWornItem, leastWornItem, totalValue };
}

// "Wardrobe cohesion" — replaces the old hardcoded 78%. There's no explicit
// "basic vs. accent" tag on a scanned item, so this leans on the two
// structured fields the data model actually has:
//   - `category` (fixed enum) for coverage — a capsule needs Tops, Bottoms,
//     and Shoes at minimum to build real outfits from, regardless of how
//     many items pile up in any one of them.
//   - `color` (fixed enum) for the basic/accent balance the task asked
//     for — real capsule-wardrobe guidance is roughly 80% neutral tones
//     anchored by a handful of accent colors, not "guess from freeform
//     subcategory text" (which aiScanner.js produces with no fixed
//     vocabulary, so keyword-matching "t-shirt"/"jeans" would be fragile).
// Plus the worn-at-least-once ratio the task specified directly.
const MIN_ITEMS_FOR_FULL_SCORE = 5;
const CORE_CATEGORIES = ['Tops', 'Bottoms', 'Shoes'];
const NEUTRAL_COLORS = new Set(['Black', 'White', 'Gray', 'Beige', 'Brown']);
const IDEAL_NEUTRAL_RATIO = 0.8;

export function calculateCohesionScore(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  // Too few items to form real outfits regardless of how well they'd
  // theoretically coordinate — capped low (30-38%) rather than let a lucky
  // 2-3 item combo score as if it were a real capsule.
  if (items.length < MIN_ITEMS_FOR_FULL_SCORE) {
    return Math.round(30 + (items.length / MIN_ITEMS_FOR_FULL_SCORE) * 10);
  }

  // Category coverage — 0-40 pts.
  const categories = new Set(items.map((item) => item.category));
  const coreCoverage = CORE_CATEGORIES.filter((category) => categories.has(category)).length / CORE_CATEGORIES.length;
  const categoryScore = coreCoverage * 40;

  // Neutral/accent color balance — 0-30 pts. Peaks at the ~80% neutral
  // ratio; an all-neutral wardrobe (nothing to accent with) and an
  // all-accent one (nothing coordinates) both score toward 0 here.
  const neutralRatio = items.filter((item) => NEUTRAL_COLORS.has(item.color)).length / items.length;
  const maxDeviation = Math.max(IDEAL_NEUTRAL_RATIO, 1 - IDEAL_NEUTRAL_RATIO);
  const colorBalanceScore = (1 - Math.abs(neutralRatio - IDEAL_NEUTRAL_RATIO) / maxDeviation) * 30;

  // Worn at least once — 0-30 pts. A capsule that never actually gets worn
  // isn't cohesive, it's just clothes sitting in a closet.
  const wornRatio = items.filter((item) => (item.wornCount || 0) > 0).length / items.length;
  const wornScore = wornRatio * 30;

  const total = categoryScore + colorBalanceScore + wornScore;
  return Math.round(Math.min(100, Math.max(0, total)));
}

// ---- Wardrobe Impact widget (WardrobeScreen's compact Eco-Score/Lifecycle
// strip) ----
// Both functions below read only `wornCount` — there's no `price` column on
// `clothes` (see 0001_init.sql's comment on `worn_count`, which was added
// specifically to unlock Cost Per Wear once pricing exists), so a real
// price-based metric isn't computable yet.

const ECO_SCORE_MIN_ITEMS = 5;
// Average wears/item that maxes out the rewear half of the score — set low
// deliberately so a genuinely worn (not hoarded) capsule reads as "great"
// well before anything unrealistic like daily wear.
const ECO_SCORE_REWEAR_TARGET = 3;

// Gamified 0-100 score rewarding a closet that's actually in rotation:
// half for how much of it has been worn at least once, half for how often
// (average wears/item, capped so one heavily-worn item can't alone max the
// score for an otherwise-idle wardrobe).
export function calculateEcoScore(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  // Too few items for the ratio-based math below to mean much — same
  // capped-low treatment as calculateCohesionScore's early return.
  if (items.length < ECO_SCORE_MIN_ITEMS) {
    return Math.round(20 + (items.length / ECO_SCORE_MIN_ITEMS) * 15);
  }

  const wornRatio = items.filter((item) => (item.wornCount || 0) > 0).length / items.length;
  const rotationScore = wornRatio * 60;

  const avgWears = items.reduce((sum, item) => sum + (item.wornCount || 0), 0) / items.length;
  const rewearScore = Math.min(avgWears / ECO_SCORE_REWEAR_TARGET, 1) * 40;

  return Math.round(Math.min(100, rotationScore + rewearScore));
}

// "In rotation" (worn at least once) vs "idle" (never worn) — the same
// worn-at-least-once split calculateCohesionScore's wornScore already uses,
// just returned as its own counts/percentages for the Lifecycle card.
export function calculateWardrobeLifecycle(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return { activeCount: 0, idleCount: 0, activePercent: 0, idlePercent: 0 };
  }

  const activeCount = items.filter((item) => (item.wornCount || 0) > 0).length;
  const idleCount = items.length - activeCount;

  return {
    activeCount,
    idleCount,
    activePercent: Math.round((activeCount / items.length) * 100),
    idlePercent: Math.round((idleCount / items.length) * 100),
  };
}
