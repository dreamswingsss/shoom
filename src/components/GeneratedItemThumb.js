// Shared thumbnail for a saved Lookbook entry (`{ name, imageUrl }`, no
// category field of its own) — WardrobeScreen's Lookbook cards and
// InspirationDetailScreen render this same shape through one component
// instead of each screen rolling its own fallback.
//
// The AI stylist now only ever suggests real wardrobe items (see
// aiChatEngine.js's RULE #5 — it no longer invents purchasable pieces or
// fetches stock photos for them), so a missing/failed `imageUrl` here is
// legacy data from before that change, not a live code path. Either way,
// this degrades to a deterministic gradient + category icon, hashed off the
// item's own name, so two different items never look identical even when
// neither has a real photo.
import { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, withAlpha } from '../theme/tokens';
import { inferItemCategory } from '../utils/inferItemCategory';

// Lightens (positive percent) or darkens (negative percent) a hex color —
// same small self-contained helper ColorSwatchPicker.js already has its own
// copy of; this project's convention is a local copy per file that needs
// one rather than a shared color-math utility module.
function shadeColor(hexColor, percent) {
  const num = parseInt(hexColor.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}

// Six two-stop gradients built off the app's own section accents (see
// theme/tokens.js) rather than arbitrary hex — placeholders stay in the same
// visual family as the rest of the app instead of reading as a bolted-on
// stock-photo-substitute palette.
const GRADIENT_PAIRS = [
  [colors.violet, shadeColor(colors.violet, -30)],
  [colors.coral, shadeColor(colors.coral, -30)],
  [colors.sky, shadeColor(colors.sky, -30)],
  [colors.sage, shadeColor(colors.sage, -30)],
  [shadeColor(colors.violet, 22), colors.violet],
  [shadeColor(colors.coral, 22), colors.coral],
];

// Stable (not random) hash — same item name always lands on the same
// gradient/icon, so a placeholder never flickers to a different look on
// re-render; same pattern utils/colorDna.js already uses for its own
// deterministic color-match scoring.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 1000;
  }
  return hash;
}

const CATEGORY_ICONS = {
  Tops: 'tshirt-crew',
  Shoes: 'shoe-sneaker',
  Bags: 'bag-personal',
  Accessories: 'sunglasses',
  Bottoms: 'hanger',
  Outerwear: 'hanger',
};

// `uri`: a real photo — a saved Lookbook entry's `imageUrl` (a wardrobe
// item's own photo at save time), or `undefined`/`null` for legacy 'new'-
// type entries saved before the stylist went wardrobe-only.
// `name`/`searchQuery`: used only to pick a stable gradient + icon when
// there's no photo (or it fails to load) — never displayed by this
// component itself, the caller renders the name as its own label.
export default function GeneratedItemThumb({ uri, name = '', searchQuery = '', style }) {
  const [failed, setFailed] = useState(false);

  if (uri && !failed) {
    return <Image source={{ uri }} style={[styles.image, style]} onError={() => setFailed(true)} />;
  }

  const key = name || searchQuery || 'item';
  const [from, to] = GRADIENT_PAIRS[hashString(key) % GRADIENT_PAIRS.length];
  const category = inferItemCategory(name, searchQuery);
  const initial = key.trim()[0]?.toUpperCase() || '?';

  return (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.image, style]}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={CATEGORY_ICONS[category]} size={28} color={withAlpha('#FFFFFF', 0.92)} />
      </View>
      <View style={styles.monogram}>
        <Text style={styles.monogramText}>{initial}</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  monogram: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: withAlpha('#000000', 0.22),
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
});
