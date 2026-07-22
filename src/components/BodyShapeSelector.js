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

// Fashion-croquis proportions — an elongated, faceless figure (head, neck,
// torso, two separate legs) instead of the old head-plus-trapezoid "sign
// icon". Every y-coordinate below is fixed across shapes (a body TYPE
// changes the shoulder/waist/hip WIDTHS, never head size or leg length);
// only the widths come from SHAPE_PROPORTIONS.
const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 220;
const CX = VIEW_WIDTH / 2;

const HEAD_R = 10;
const HEAD_CY = 18;
const NECK_Y = HEAD_CY + HEAD_R + 3;
const NECK_HALF = 6;
const SHOULDER_Y = 42;
const WAIST_Y = 98;
const HIP_Y = 122;
const CROTCH_Y = 130;
const ANKLE_Y = 208;

const MAX_HALF = 34;
const LEG_GAP_HALF = 4;
const ANKLE_HALF = 7;

// Torso outline: neck -> rounded shoulder -> waist taper -> hip flare,
// mirrored left/right around CX, every transition a cubic bezier so the
// silhouette reads as a body, not a chevron. Bottom edge (at HIP_Y) is a
// straight line — that's the seam the two leg paths below pick up from.
function buildTorsoPath({ shoulder, waist, hip }) {
  const sHalf = shoulder * MAX_HALF;
  const wHalf = waist * MAX_HALF;
  const hHalf = hip * MAX_HALF;

  const neckL = CX - NECK_HALF;
  const neckR = CX + NECK_HALF;
  const shL = CX - sHalf;
  const shR = CX + sHalf;
  const wL = CX - wHalf;
  const wR = CX + wHalf;
  const hL = CX - hHalf;
  const hR = CX + hHalf;

  return [
    `M ${neckL} ${NECK_Y}`,
    `C ${neckL - 2} ${NECK_Y + 6}, ${shL} ${SHOULDER_Y - 6}, ${shL} ${SHOULDER_Y}`,
    `C ${shL} ${SHOULDER_Y + 26}, ${wL} ${WAIST_Y - 20}, ${wL} ${WAIST_Y}`,
    `C ${wL} ${WAIST_Y + 14}, ${hL} ${HIP_Y - 12}, ${hL} ${HIP_Y}`,
    `L ${hR} ${HIP_Y}`,
    `C ${hR} ${HIP_Y - 12}, ${wR} ${WAIST_Y + 14}, ${wR} ${WAIST_Y}`,
    `C ${wR} ${WAIST_Y - 20}, ${shR} ${SHOULDER_Y + 26}, ${shR} ${SHOULDER_Y}`,
    `C ${shR} ${SHOULDER_Y - 6}, ${neckR + 2} ${NECK_Y + 6}, ${neckR} ${NECK_Y}`,
    'Z',
  ].join(' ');
}

// One leg, `side` = +1 (right) or -1 (left). Starts exactly on the torso's
// own hip line (same X coordinates as buildTorsoPath's hip points) so the
// two shapes read as one continuous figure with no seam or overlap, tapers
// to a fixed ankle width regardless of body shape (ankles don't vary by
// silhouette category the way waist/hip do), and leaves LEG_GAP_HALF*2 of
// negative space between the two legs at the crotch — the detail that
// actually reads as "two legs" instead of "a skirt".
function buildLegPath(hip, side) {
  const hHalf = hip * MAX_HALF;
  const innerTopX = CX + side * LEG_GAP_HALF;
  const outerHipX = CX + side * hHalf;
  const outerAnkleX = CX + side * ANKLE_HALF;
  const innerAnkleX = CX + side * (LEG_GAP_HALF * 0.4);

  return [
    `M ${innerTopX} ${HIP_Y}`,
    `L ${outerHipX} ${HIP_Y}`,
    `C ${outerHipX} ${HIP_Y + 30}, ${outerAnkleX} ${ANKLE_Y - 40}, ${outerAnkleX} ${ANKLE_Y}`,
    `L ${innerAnkleX} ${ANKLE_Y}`,
    `C ${innerAnkleX} ${ANKLE_Y - 50}, ${innerTopX} ${CROTCH_Y + 10}, ${innerTopX} ${CROTCH_Y}`,
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
      <Circle cx={CX} cy={HEAD_CY} r={HEAD_R} fill={colors.inverseBackground} />
      <Path d={buildTorsoPath(proportions)} fill={colors.inverseBackground} />
      <Path d={buildLegPath(proportions.hip, -1)} fill={colors.inverseBackground} />
      <Path d={buildLegPath(proportions.hip, 1)} fill={colors.inverseBackground} />
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
