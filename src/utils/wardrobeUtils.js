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

  // Free-tier stat that doesn't need any Planner history to be meaningful —
  // `item.wornCount` is the direct "mark as worn" counter (ItemDetailScreen/
  // WardrobeCatalogScreen), a separate signal from the scheduledOutfits-
  // derived most/least-worn above, but the simplest honest "how much of
  // your wardrobe actually gets used" number for a client with zero Planner
  // activity yet.
  const neverWornCount = wardrobeItems.filter((item) => !(item.wornCount > 0)).length;

  return { mostWornItem, leastWornItem, totalValue, neverWornCount };
}

// "Wardrobe cohesion" — replaces the old hardcoded 78%. There's no explicit
// "basic vs. accent" tag on a scanned item, so this leans on the structured
// fields the data model actually has:
//   - `category` (fixed enum) for coverage — a capsule needs Tops, Bottoms,
//     and Shoes at minimum to build real outfits from, regardless of how
//     many items pile up in any one of them.
//   - `color` (fixed enum) for the basic/accent balance — real
//     capsule-wardrobe guidance is roughly 80% neutral tones anchored by a
//     handful of accent colors, not "guess from freeform subcategory text"
//     (which aiScanner.js produces with no fixed vocabulary, so keyword-
//     matching "t-shirt"/"jeans" would be fragile).
//   - `style` (freeform 1-2 Russian words from aiScanner.js, not a fixed
//     enum) for how concentrated the wardrobe is around one aesthetic —
//     see getStyleScore's own comment for why this replaced an earlier
//     worn-at-least-once version of this third component.
const MIN_ITEMS_FOR_FULL_SCORE = 5;
const CORE_CATEGORIES = ['Tops', 'Bottoms', 'Shoes'];
const NEUTRAL_COLORS = new Set(['Black', 'White', 'Gray', 'Beige', 'Brown']);
const IDEAL_NEUTRAL_RATIO = 0.8;
// How many of the wardrobe's most-common style groups still count as
// "cohesive" — a wardrobe split across its top 2 styles (e.g. mostly
// Кэжуал with a handful of Классика) still mixes fine within each; three or
// more real style families competing is what actually gets hard to combine.
const STYLE_DOMINANT_GROUPS = 2;

function normalizeStyle(style) {
  return typeof style === 'string' ? style.trim().toLowerCase() : '';
}

// Style concentration — 0-30 pts. Replaces an earlier version of this third
// component that scored `item.wornCount > 0` (the "Носил сегодня" button's
// own counter) — that required a manual tap per item to ever move off 0,
// which is a UX cost this score shouldn't depend on. `style` instead comes
// for free with every AI scan (aiScanner.js's SYSTEM_PROMPT always returns
// it), so this needs no additional input from the client at all. Grouped by
// exact trimmed/case-folded string match, not a fixed vocabulary — close
// enough for a same-model AI describing visually similar items, though two
// near-synonyms ("Спорт" vs "Спортивный") will still count as separate
// groups.
function getStyleScore(items) {
  const styledItems = items.filter((item) => normalizeStyle(item.style));
  if (styledItems.length === 0) return 0;

  const counts = new Map();
  styledItems.forEach((item) => {
    const key = normalizeStyle(item.style);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const topGroupsCount = Array.from(counts.values())
    .sort((a, b) => b - a)
    .slice(0, STYLE_DOMINANT_GROUPS)
    .reduce((sum, count) => sum + count, 0);

  return (topGroupsCount / styledItems.length) * 30;
}

// Same three components calculateCohesionScore always computed internally,
// just returned individually instead of pre-summed — CohesionBreakdownSheet
// shows these as three separate bars (the "visible half" of the free-tier
// preview; see that component's own comment), calculateCohesionScore below
// stays a thin wrapper around this so its existing call sites (the hub
// tile's `N%`, ProfileScreen's stat cell) don't need to change at all.
export function getCohesionBreakdown(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return { categoryScore: 0, colorBalanceScore: 0, styleScore: 0, total: 0 };
  }

  // Too few items to form real outfits regardless of how well they'd
  // theoretically coordinate — capped low (30-38%) rather than let a lucky
  // 2-3 item combo score as if it were a real capsule. No per-component
  // breakdown is meaningful at this size, so it's split evenly across the
  // three just so the bars render something proportionate rather than 0/0/0.
  if (items.length < MIN_ITEMS_FOR_FULL_SCORE) {
    const total = Math.round(30 + (items.length / MIN_ITEMS_FOR_FULL_SCORE) * 10);
    return { categoryScore: total * 0.4, colorBalanceScore: total * 0.3, styleScore: total * 0.3, total };
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

  const styleScore = getStyleScore(items);

  const total = Math.round(Math.min(100, Math.max(0, categoryScore + colorBalanceScore + styleScore)));
  return { categoryScore, colorBalanceScore, styleScore, total };
}

export function calculateCohesionScore(items = []) {
  return getCohesionBreakdown(items).total;
}

