import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '../theme/tokens';

const DEFAULT_SIZE = 48;
const FRAME_BORDER_WIDTH = 2;
const FRAME_PADDING = spacing.xs;

// Lightens (positive percent) or darkens (negative percent) a hex color.
function shadeColor(hexColor, percent) {
  const num = parseInt(hexColor.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}

// Diagonal sheen: base hue at the bottom-left, a lighter highlight toward
// the top-right — approximates a ~315° linear-gradient direction and reads
// as a strand of hair catching the light.
function HairSwatch({ hexColor, size }) {
  return (
    <LinearGradient
      colors={[hexColor, shadeColor(hexColor, 20)]}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

// Radial depth: center ~12% darker than the edge, imitating a pupil sitting
// inside the iris rather than a flat disc of color.
function EyeSwatch({ hexColor, size }) {
  const gradientId = `eye-${hexColor.replace('#', '')}`;
  return (
    <Svg width={size} height={size} style={{ borderRadius: size / 2 }}>
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="55%">
          <Stop offset="0%" stopColor={shadeColor(hexColor, -12)} />
          <Stop offset="100%" stopColor={hexColor} />
        </RadialGradient>
      </Defs>
      <Circle cx="50%" cy="50%" r="50%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

// Shared swatch-grid picker for any color-based profile attribute (skin
// tone, hair color, eye color, …). Options are `{ label, hexColor }`;
// selection is tracked by `label`.
//
// `swatchStyle` picks the fill treatment:
//   - 'flat' (default): solid color — used for skin tone.
//   - 'hair': diagonal highlight gradient, for a strand-of-hair look.
//   - 'eye': radial gradient darkened at the center, for iris depth.
export default function ColorSwatchPicker({
  label,
  options,
  value,
  onChange,
  swatchStyle = 'flat',
  size = DEFAULT_SIZE,
  center = false,
  disabled = false,
}) {
  const { t } = useTranslation();

  // Must match the frame's actual footprint (content + padding on every
  // side + border on every side) so the label column is never narrower
  // than the frame it's centering — that mismatch was the other half of
  // the "crooked" bug.
  const frameSize = size + FRAME_PADDING * 2 + FRAME_BORDER_WIDTH * 2;
  const itemWidth = frameSize + spacing.xs;

  return (
    <View style={styles.section}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      <View style={[styles.wrap, center && styles.wrapCenter]}>
        {options.map((option) => {
          const isSelected = value === option.label;
          return (
            <TouchableOpacity
              key={option.label}
              style={[styles.item, { width: itemWidth }]}
              onPress={() => onChange(option.label)}
              disabled={disabled}
              activeOpacity={0.8}
            >
              {/* Square selection frame, sized by flex to fit the circle + fixed
                  padding on every side — no manual width/height math, so the
                  frame can never end up off-center or lopsided. Border is
                  always 2px; only its color toggles, so nothing shifts on select. */}
              <View style={[styles.frame, isSelected && styles.frameSelected]}>
                {swatchStyle === 'hair' ? (
                  <HairSwatch hexColor={option.hexColor} size={size} />
                ) : swatchStyle === 'eye' ? (
                  <EyeSwatch hexColor={option.hexColor} size={size} />
                ) : (
                  <View
                    style={{
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      backgroundColor: option.hexColor,
                    }}
                  />
                )}
              </View>
              <Text
                style={[styles.itemLabel, isSelected && styles.itemLabelSelected]}
                numberOfLines={1}
              >
                {t(`profile.options.${option.label}`, option.label)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.md },
  sectionLabel: { ...typography.label, marginBottom: spacing.xs, marginTop: spacing.xs },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wrapCenter: { justifyContent: 'center' },
  item: { alignItems: 'center' },
  // No explicit width/height: the frame sizes itself to the circle child
  // plus this padding plus the border, on all four sides equally — that's
  // what keeps it perfectly square and centered regardless of swatch size.
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: FRAME_PADDING,
    borderWidth: FRAME_BORDER_WIDTH,
    borderColor: 'transparent',
    borderRadius: radius.sm,
  },
  frameSelected: { borderColor: colors.inverseBackground },
  itemLabel: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  itemLabelSelected: { color: colors.textPrimary, fontWeight: '700' },
});
