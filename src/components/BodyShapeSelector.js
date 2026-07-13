import { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { FadeInView } from './AnimatedPressable';
import { colors, spacing, radius, typography } from '../theme/tokens';

// Real illustration files (assets/body-shapes/<name>.png) — empty for now.
// Metro resolves `require()` at BUNDLE time, not runtime, so a require()
// call pointing at a file that doesn't exist yet fails the build itself —
// wrapping it in try/catch doesn't help, that only guards runtime errors.
// So rather than ship a require() that breaks the app today, this map
// starts empty and BodyShapeIllustration below falls back to a generated
// SVG silhouette. Once real artwork exists, add entries here exactly like
// this (uncommented, pointing at a file that's actually on disk):
//   Triangle: require('../../assets/body-shapes/triangle.png'),
//   Hourglass: require('../../assets/body-shapes/hourglass.png'),
// Any shape left out of this map keeps using the SVG fallback.
const BODY_SHAPE_IMAGES = {};

// Body shapes are literally defined by relative shoulder/waist/hip
// proportions (that's the actual styling concept, not a stand-in) — so
// rather than needing bespoke artwork per shape, one silhouette renderer
// driven by these three ratios covers all of them. Falls back to a
// Rectangle-like default for any label not listed (e.g. a future addition
// to constants/profileOptions.js that forgot to update this map).
const SHAPE_PROPORTIONS = {
  Hourglass: { shoulder: 0.85, waist: 0.5, hip: 0.85 },
  'Pear (Triangle)': { shoulder: 0.55, waist: 0.58, hip: 0.95 },
  Triangle: { shoulder: 0.55, waist: 0.58, hip: 0.95 },
  'Apple (Round)': { shoulder: 0.75, waist: 0.92, hip: 0.7 },
  Rectangle: { shoulder: 0.72, waist: 0.68, hip: 0.72 },
  'Inverted Triangle': { shoulder: 0.95, waist: 0.6, hip: 0.55 },
  Trapezoid: { shoulder: 0.85, waist: 0.55, hip: 0.62 },
  Oval: { shoulder: 0.65, waist: 0.88, hip: 0.65 },
};
const DEFAULT_PROPORTIONS = SHAPE_PROPORTIONS.Rectangle;

const VIEW_WIDTH = 80;
const VIEW_HEIGHT = 132;
const HEAD_RADIUS = 9;
const TORSO_TOP = 30;
const TORSO_MID = 72;
const TORSO_BOTTOM = 124;
const MAX_HALF_WIDTH = 30;

// Smooth tapered outline through (shoulder width, waist width, hip width) —
// mirrored left/right around the vertical centerline, with a cubic-bezier
// curve at each transition instead of straight edges so it reads as a body,
// not a chevron.
function buildTorsoPath({ shoulder, waist, hip }) {
  const cx = VIEW_WIDTH / 2;
  const sHalf = shoulder * MAX_HALF_WIDTH;
  const wHalf = waist * MAX_HALF_WIDTH;
  const hHalf = hip * MAX_HALF_WIDTH;
  const topL = cx - sHalf;
  const topR = cx + sHalf;
  const midL = cx - wHalf;
  const midR = cx + wHalf;
  const botL = cx - hHalf;
  const botR = cx + hHalf;

  return [
    `M ${topL} ${TORSO_TOP}`,
    `C ${topL} ${TORSO_TOP + 16}, ${midL} ${TORSO_MID - 16}, ${midL} ${TORSO_MID}`,
    `C ${midL} ${TORSO_MID + 16}, ${botL} ${TORSO_BOTTOM - 16}, ${botL} ${TORSO_BOTTOM}`,
    `L ${botR} ${TORSO_BOTTOM}`,
    `C ${botR} ${TORSO_BOTTOM - 16}, ${midR} ${TORSO_MID + 16}, ${midR} ${TORSO_MID}`,
    `C ${midR} ${TORSO_MID - 16}, ${topR} ${TORSO_TOP + 16}, ${topR} ${TORSO_TOP}`,
    'Z',
  ].join(' ');
}

function BodyShapeIllustration({ shape, size = 140 }) {
  const imageSource = BODY_SHAPE_IMAGES[shape];
  if (imageSource) {
    return <Image source={imageSource} style={{ width: size, height: size * (VIEW_HEIGHT / VIEW_WIDTH) }} resizeMode="contain" />;
  }

  const proportions = SHAPE_PROPORTIONS[shape] || DEFAULT_PROPORTIONS;
  const scale = size / VIEW_WIDTH;

  return (
    <Svg width={size} height={VIEW_HEIGHT * scale} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
      <Circle
        cx={VIEW_WIDTH / 2}
        cy={TORSO_TOP - HEAD_RADIUS - 6}
        r={HEAD_RADIUS}
        fill={colors.inverseBackground}
      />
      <Path d={buildTorsoPath(proportions)} fill={colors.inverseBackground} />
    </Svg>
  );
}

// Visual body-shape picker — full grid of chip options up front; tapping one
// collapses the grid down to just that chip, with its silhouette fading in
// below. Tapping the chip or the silhouette again reopens the full grid.
// Controlled (`value`/`onChange`, same contract as ColorSwatchPicker) so the
// actual commit to the store/DB stays owned by whatever screen renders this
// — OnboardingScreen's answersRef, EditProfileScreen's form state — and
// only happens when its own Continue/Save button fires, per spec.
export default function BodyShapeSelector({ label, options, value, onChange, disabled = false }) {
  const { t } = useTranslation();

  // Local UI-toggle state, separate from `value` — this is what lets
  // "tap again to cancel" collapse/reopen the view instantly without
  // depending on how the parent screen reacts to onChange. Re-synced
  // whenever `value` changes from outside (e.g. EditProfileScreen resetting
  // its form, or switching gender re-deriving a now-invalid selection).
  const [expandedShape, setExpandedShape] = useState(value || null);

  useEffect(() => {
    setExpandedShape(value || null);
  }, [value]);

  function handleSelect(shape) {
    if (disabled) return;
    setExpandedShape(shape);
    onChange(shape);
  }

  function handleCancel() {
    if (disabled) return;
    setExpandedShape(null);
    onChange(null);
  }

  return (
    <View style={styles.section}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}

      {expandedShape ? (
        <View style={styles.expandedWrap}>
          <TouchableOpacity
            style={[styles.chip, styles.chipSelected]}
            onPress={handleCancel}
            disabled={disabled}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, styles.chipTextSelected]}>
              {t(`onboarding.options.${expandedShape}`, expandedShape)}
            </Text>
          </TouchableOpacity>

          <FadeInView style={styles.illustrationWrap}>
            <TouchableOpacity onPress={handleCancel} disabled={disabled} activeOpacity={0.85}>
              <BodyShapeIllustration shape={expandedShape} />
            </TouchableOpacity>
          </FadeInView>
        </View>
      ) : (
        <View style={styles.chipWrap}>
          {options.map((option) => (
            <TouchableOpacity
              key={option}
              style={styles.chip}
              onPress={() => handleSelect(option)}
              disabled={disabled}
              activeOpacity={0.8}
            >
              <Text style={styles.chipText} numberOfLines={1} adjustsFontSizeToFit>
                {t(`onboarding.options.${option}`, option)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.md },
  sectionLabel: { ...typography.label, marginBottom: spacing.xs, marginTop: spacing.xs },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipSelected: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: colors.inverseText },

  expandedWrap: { alignItems: 'center' },
  illustrationWrap: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
