// Shared keyword classifier — no category field ever comes back from
// Gemini for a suggested item (only `name`/`search_query`, see
// aiChatEngine.js's buildSystemPrompt/buildInspirationSystemPrompt), so
// both `components/GeneratedItemThumb.js` (picking a placeholder icon) and
// `services/aiChatEngine.js` (building a generic fallback Unsplash query,
// e.g. "black pants flat lay") need to guess one from the item's own text.
// Extracted here as ONE shared classifier instead of two copies that could
// drift apart — a "Bonobos Chinos" item should infer the same category
// (Bottoms) whether it's picking an icon or building a search query.
export function inferItemCategory(name = '', searchQuery = '') {
  const haystack = `${name} ${searchQuery}`.toLowerCase();
  // Leading `\b` only (not trailing) is deliberate — these need to match
  // inside plurals ("chino" in "Chinos", "jean" in "Jeans", "trouser" in
  // "Trousers", "sneaker" in "Sneakers") the way a trailing boundary
  // wouldn't. "oxford" is deliberately NOT a Shoes keyword despite "Cap-Toe
  // Oxford" being a real shoe name — "Oxford" is equally common as a SHIRT
  // fabric ("Cotton Oxford Shirt"), and that ambiguity can't be resolved by
  // a keyword list; a cap-toe/derby/brogue shoe still falls back to Tops's
  // default here, an acceptable miss since this only ever drives a
  // decorative icon or a generic fallback search term, never anything a
  // client reads as a fact about the item.
  if (/\b(boot|sneaker|shoe|heel|sandal|loafer|trainer|derby|brogue)/.test(haystack)) return 'Shoes';
  if (/\b(jacket|coat|blazer|parka|trench|puffer|cardigan)/.test(haystack)) return 'Outerwear';
  if (/\b(jean|pant|trouser|short|skirt|legging|chino)/.test(haystack)) return 'Bottoms';
  if (/\b(bag|tote|backpack|clutch|purse)/.test(haystack)) return 'Bags';
  // No "cap" here (deliberately) — `\bcap\b` still matches inside
  // compound shoe names like "Cap-Toe Oxford" (a word boundary exists at
  // the hyphen regardless of a trailing `\b`), which is what originally
  // misclassified that item as an accessory. "hat" covers most headwear
  // inference on its own; losing "cap" as a trigger is an acceptable
  // cosmetic tradeoff for not misreading shoe names.
  if (/\b(belt|hat|sunglasses|necklace|watch|scarf|glove|jewelr)/.test(haystack)) return 'Accessories';
  return 'Tops';
}
