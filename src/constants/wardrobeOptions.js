// Shared between the wardrobe scan/confirm flow (aiScanner.js,
// WardrobeScreen.js), the catalog browser (WardrobeCatalogScreen.js), and
// the AI stylist prompt (aiStylist.js) — all four need the exact same
// category list.

export const CATEGORIES = ['Tops', 'Bottoms', 'Outerwear', 'Shoes', 'Accessories', 'Bags'];

export const CATEGORY_DESCRIPTIONS = {
  Tops: 'T-shirts, shirts, and sweaters',
  Bottoms: 'Trousers, jeans, and shorts',
  Outerwear: 'Coats, jackets, and blazers',
  Shoes: 'Sneakers, boots, and heels',
  Accessories: 'Belts, jewelry, and hats',
  Bags: 'Totes, backpacks, and clutches',
};

// Shared with the scan-confirm ChipPicker (WardrobeScreen) and the
// ItemDetailScreen inline edit panel — both need the exact same color list.
export const COLOR_OPTIONS = [
  'Black',
  'White',
  'Gray',
  'Beige',
  'Brown',
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Pink',
  'Multicolor',
];
