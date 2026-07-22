import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Circle, Path } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { FadeInView } from './AnimatedPressable';
import { colors, spacing, radius, typography } from '../theme/tokens';

const SELECT_POP_DURATION = 220;
const SELECT_POP_EASING = Easing.out(Easing.back(1.6));

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

// Faceless head + hair "cap" — the illustration shown below the grid once
// a hair color is picked (RegistrationFlow's `hairColor` step only, see
// this file's own default export). Mirrors BodyShapeSelector's own
// silhouette-illustration pattern (a plain, faceless shape whose fill
// carries the actual selected attribute) rather than any real skin-toned
// face, since skin tone hasn't been asked yet at this point in the flow —
// PARAM_STEP_KEYS asks hairColor well before skinTone. The hair shape
// itself reuses HairSwatch's own diagonal sheen gradient so the small grid
// swatch and this larger illustration read as the same material.
const HAIR_ILLUSTRATION_SIZE = 120;
const HEAD_R = 30;
const HEAD_CX = 50;
const HEAD_CY = 62;

function buildHairCapPath() {
  const topY = HEAD_CY - HEAD_R - 8;
  const sideL = HEAD_CX - HEAD_R - 3;
  const sideR = HEAD_CX + HEAD_R + 3;
  const jawY = HEAD_CY + HEAD_R * 0.35;
  const partY = HEAD_CY - HEAD_R * 0.7;

  return [
    `M ${sideL} ${jawY}`,
    `C ${sideL - 3} ${HEAD_CY - HEAD_R * 0.6}, ${sideL} ${topY + 4}, ${HEAD_CX - HEAD_R * 0.4} ${topY}`,
    `C ${HEAD_CX - 6} ${topY - 4}, ${HEAD_CX + 6} ${topY - 4}, ${HEAD_CX + HEAD_R * 0.4} ${topY}`,
    `C ${sideR} ${topY + 4}, ${sideR + 3} ${HEAD_CY - HEAD_R * 0.6}, ${sideR} ${jawY}`,
    `C ${sideR} ${HEAD_CY - HEAD_R * 0.2}, ${HEAD_CX + HEAD_R} ${partY}, ${HEAD_CX} ${partY}`,
    `C ${HEAD_CX - HEAD_R} ${partY}, ${sideL} ${HEAD_CY - HEAD_R * 0.2}, ${sideL} ${jawY}`,
    'Z',
  ].join(' ');
}

function HairColorIllustration({ hexColor, size = HAIR_ILLUSTRATION_SIZE }) {
  const gradientId = `hair-illustration-${hexColor.replace('#', '')}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gradientId} cx="30%" cy="80%" r="90%">
          <Stop offset="0%" stopColor={hexColor} />
          <Stop offset="100%" stopColor={shadeColor(hexColor, 20)} />
        </RadialGradient>
      </Defs>
      {/* Plain, faceless head — deliberately no eyes/mouth, same "not a
          real face" convention BodyShapeIllustration uses for its own
          silhouette, since this is illustrating a HAIR COLOR choice, not a
          skin tone (unasked at this point in the flow). */}
      <Circle cx={HEAD_CX} cy={HEAD_CY} r={HEAD_R} fill={colors.surface} stroke={colors.borderStrong} strokeWidth={1.5} />
      <Path d={buildHairCapPath()} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

// One swatch + its own selection-pop animation — a shared value has to
// live per-item (not once for the whole grid), since each swatch animates
// independently of whichever one was previously selected. Selecting used
// to be an instant style snap (border color only); this adds a brief
// overshoot scale so the pick itself reads as a deliberate, springy
// action instead of a flat toggle, matching the rest of the smoothed-out
// onboarding flow this is normally used inside.
function SwatchItem({ option, isSelected, onPress, disabled, swatchStyle, size, frameSize, itemStyle, t }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(isSelected ? 1.1 : 1, {
      duration: SELECT_POP_DURATION,
      easing: SELECT_POP_EASING,
    });
  }, [isSelected, scale]);

  const animatedFrameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity
      style={[styles.item, itemStyle]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {/* Two nested boxes, not one — the shadow and the circular clip can't
          live on the same View. `frameShadowWrap` (outer) carries the pop
          scale + the selected drop-shadow and has NO `overflow: hidden`:
          on iOS, a shadow is drawn OUTSIDE the view's own bounds, so
          clipping that same view would clip its shadow down to nothing.
          `frame` (inner) carries the border, the explicit `frameSize`
          pixel box, and `overflow: 'hidden'` — THAT'S what clips the
          swatch to a mathematically exact circle (see `frameSize`'s own
          comment above for why explicit size + clipping replaced the old
          shrink-wrap-via-padding approach). Both boxes share the same
          `borderRadius: radius.pill` so the shadow's own rendered shape
          still reads as round, not as a rectangle with a circle cut out of
          it.
          Selected = Apple's own color-picker convention (Settings, Reminders
          tag colors): a ring in the SWATCH'S OWN hue, held away from the
          circle by an opaque surface-colored gap — not one fixed accent
          color for every swatch. `frameSelectedShadow` is a flat addition
          (not a replacement) so a pale/light swatch — its own-color ring
          would otherwise nearly vanish against the gap — still visibly
          lifts off the page. */}
      <Animated.View
        style={[
          styles.frameShadowWrap,
          { width: frameSize, height: frameSize },
          isSelected && styles.frameSelectedShadow,
          animatedFrameStyle,
        ]}
      >
        <View
          style={[
            styles.frame,
            isSelected && { borderColor: option.hexColor, backgroundColor: colors.surface },
          ]}
        >
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
      </Animated.View>
      <Text style={[styles.itemLabel, isSelected && styles.itemLabelSelected]} numberOfLines={1}>
        {t(`profile.options.${option.label}`, option.label)}
      </Text>
    </TouchableOpacity>
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
  // Forces exactly this many swatches per row via a percentage flexBasis,
  // regardless of screen width or how many options this particular list
  // has — RegistrationFlow's onboarding steps want a clean, predictable
  // 3-across grid; left `null` (the old auto pixel-sized behavior, via
  // `itemWidth` below) for callers like EditProfileScreen that were never
  // reported as needing a fixed column count.
  columns = null,
  // Defaults true — matches the behavior every EXISTING `swatchStyle="hair"`
  // caller (RegistrationFlow's onboarding step, ColorDnaCalibrationSheet)
  // already had before this became an explicit prop, so neither needed a
  // call-site change. EditProfileScreen is the one caller that opts OUT
  // (`showIllustration={false}`) — a dense, scrollable settings list has no
  // room for a 120px illustration under every single field, and unlike
  // onboarding's one-question-per-screen pacing, there's no dead space here
  // for it to fill.
  showIllustration = true,
  disabled = false,
}) {
  const { t } = useTranslation();

  // Must match the frame's actual footprint (content + padding on every
  // side + border on every side) — both for the label column below (never
  // narrower than the frame it's centering) AND now for the frame's own
  // explicit width/height (see `frame` style): letting the frame just
  // shrink-wrap its child via padding, with no explicit size of its own,
  // is what let the ring look "crooked" — any sub-pixel rounding in the
  // child's own layout (the gradient/SVG swatch inside) could poke a
  // fraction of a pixel past the ring on one side but not the others,
  // since nothing was clipping the frame to an exact circle. Giving the
  // frame this precomputed pixel size directly, plus `overflow: 'hidden'`,
  // makes the ring's own circle authoritative — the swatch inside is
  // clipped to it, not just visually adjacent to it.
  const frameSize = size + FRAME_PADDING * 2 + FRAME_BORDER_WIDTH * 2;
  const itemWidth = frameSize + spacing.xs;
  const itemStyle = columns ? { flexBasis: `${100 / columns}%` } : { width: itemWidth };

  const selectedOption = options.find((option) => option.label === value);

  return (
    <View style={styles.section}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      <View style={[styles.wrap, center && styles.wrapCenter]}>
        {options.map((option) => (
          <SwatchItem
            key={option.label}
            option={option}
            isSelected={value === option.label}
            onPress={() => onChange(option.label)}
            disabled={disabled}
            swatchStyle={swatchStyle}
            size={size}
            frameSize={frameSize}
            itemStyle={itemStyle}
            t={t}
          />
        ))}
      </View>

      {/* Hair-color-only: an illustration of the actual choice, the same
          idea as BodyShapeSelector's own silhouette-per-selection (see
          HairColorIllustration's own comment for why it's a faceless head
          rather than a real face). Not gated behind `columns` — this is
          about `swatchStyle`, not the grid layout those two happen to be
          set together for in RegistrationFlow. */}
      {swatchStyle === 'hair' && showIllustration && selectedOption && (
        <FadeInView style={styles.illustrationWrap}>
          <HairColorIllustration hexColor={selectedOption.hexColor} />
        </FadeInView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // spacing.lg (not .md) — EditProfileScreen stacks Hair/Eye/Skin Tone back
  // to back with no divider between them; anything tighter and each
  // section's small swatch labels read as touching the next section's
  // caption above it.
  section: { marginBottom: spacing.lg },
  sectionLabel: { ...typography.label, marginBottom: spacing.xs, marginTop: spacing.xs },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wrapCenter: { justifyContent: 'center', alignItems: 'center' },
  item: { alignItems: 'center' },
  illustrationWrap: {
    marginTop: spacing.md,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Outer box — carries the pop-scale transform and (when selected) the
  // drop-shadow. Deliberately NOT `overflow: hidden`: iOS draws a View's
  // shadow outside its own bounds, so clipping this box would clip its own
  // shadow away. Same `borderRadius: radius.pill` as `frame` below so the
  // shadow itself still reads as cast from a circle.
  frameShadowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  // Subtle lift, independent of hue — the safety net for a same-color ring
  // picked against a pale swatch (e.g. a light skin tone), where the ring
  // would otherwise blend into its own surface-colored gap.
  frameSelectedShadow: {
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 3,
  },
  // Inner box — fills `frameShadowWrap` exactly (`flex: 1`, so it always
  // matches the explicit `frameSize` pixel box passed in from the call
  // site) and does the actual circular clipping. `radius.pill` (999)
  // always exceeds half of `frameSize`, so RN clamps it down to a true
  // circle; `overflow: 'hidden'` then clips the swatch child to exactly
  // that circle instead of merely sitting adjacent to it — the actual fix
  // for the old crooked/ragged edge (see `frameSize`'s own comment for the
  // full explanation). Border/background are transparent by default and
  // only get their real (swatch-hue-matched) values inline on selection —
  // see SwatchItem above.
  frame: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: FRAME_PADDING,
    borderWidth: FRAME_BORDER_WIDTH,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  itemLabel: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  itemLabelSelected: { color: colors.textPrimary, fontWeight: '700' },
});
