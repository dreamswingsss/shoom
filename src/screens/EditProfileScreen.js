import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { colors, spacing, radius, opacity, buttons, typography, shadows } from '../theme/tokens';
import ScreenContainer from '../components/ScreenContainer';
import {
  GENDERS,
  EYE_COLORS,
  SKIN_TONES,
  STYLE_VIBES,
  MAX_STYLE_VIBES,
  getHairColorOptions,
  getBodyTypeOptions,
  filterDigits,
} from '../constants/profileOptions';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import BodyShapeSelector from '../components/BodyShapeSelector';
import { scrollFieldIntoView } from '../utils/scrollFieldIntoView';

// Display-only unit toggle, matching RegistrationFlow's own measurements
// step exactly (see that file's own comment on `unitSystem`) — 'metric' is
// what every existing validation/save path here already assumes. Switching
// to 'imperial' relabels the fields (ft/lbs) but does not convert the
// number typed in; real cm<->ft/in and kg<->lbs conversion is follow-up
// work, not something to fake here.
const UNIT_SYSTEMS = ['metric', 'imperial'];

function toInputString(value) {
  return value != null ? String(value) : '';
}

// Redesigned to share RegistrationFlow's visual language (Manrope weights,
// big/bold/centered titles, pill chips, floating full-width Save button)
// instead of this screen's old plain hairline-row list — see this file's
// own git history for the "cheap, inconsistent" look that replaced.
//
// Grouped into three collapsible accordion sections (Basic Info / Body
// Measurements / Style Preferences) instead of five back-to-back cards
// dumped into one continuous scroll — `activeSection` tracks which ONE is
// open at a time (classic accordion, not independent toggles), so a client
// editing their hair color isn't also scrolling past a wall of unrelated
// measurement fields to get there. Still a single ScreenContainer/ScrollView
// (not a step wizard) — collapsing a section hides it, it doesn't navigate
// away from the others.
export default function EditProfileScreen({ onDone }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const gender = useUserStore((state) => state.gender);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const skinTone = useUserStore((state) => state.skinTone);
  const bodyType = useUserStore((state) => state.bodyType);
  const height = useUserStore((state) => state.height);
  const weight = useUserStore((state) => state.weight);
  const measurements = useUserStore((state) => state.measurements);
  const stylePreferences = useUserStore((state) => state.stylePreferences);
  const styleVibes = useUserStore((state) => state.styleVibes);
  const toggleStyleVibe = useUserStore((state) => state.toggleStyleVibe);
  const updateProfile = useUserStore((state) => state.updateProfile);

  const [formGender, setFormGender] = useState(gender);
  const [formHairColor, setFormHairColor] = useState(hairColor);
  const [formEyeColor, setFormEyeColor] = useState(eyeColor);
  const [formSkinTone, setFormSkinTone] = useState(skinTone);
  const [formBodyType, setFormBodyType] = useState(bodyType);
  const [formHeight, setFormHeight] = useState(toInputString(height));
  const [formWeight, setFormWeight] = useState(toInputString(weight));
  const [formUnitSystem, setFormUnitSystem] = useState('metric');
  const [formShoulders, setFormShoulders] = useState(toInputString(measurements?.shoulders));
  const [formChest, setFormChest] = useState(toInputString(measurements?.chest));
  const [formWaist, setFormWaist] = useState(toInputString(measurements?.waist));
  const [formHips, setFormHips] = useState(toInputString(measurements?.hips));
  const [formStylePreferences, setFormStylePreferences] = useState(stylePreferences || '');

  const [activeSection, setActiveSection] = useState('basicInfo');
  function toggleSection(key) {
    // AccordionSection itself now animates its own open/close (see its own
    // comment) — LayoutAnimation used to drive this, but it's a documented
    // no-op on react-native-web, and this app always runs as web (Telegram
    // Mini App WebView), so every expand/collapse here was actually
    // snapping instantly with zero animation.
    setActiveSection((current) => (current === key ? null : key));
  }

  function handleSave() {
    updateProfile({
      gender: formGender,
      hairColor: formHairColor,
      eyeColor: formEyeColor,
      skinTone: formSkinTone,
      bodyType: formBodyType,
      height: formHeight ? Number(formHeight) : null,
      weight: formWeight ? Number(formWeight) : null,
      measurements: {
        shoulders: formShoulders ? Number(formShoulders) : null,
        chest: formChest ? Number(formChest) : null,
        waist: formWaist ? Number(formWaist) : null,
        hips: formHips ? Number(formHips) : null,
      },
      stylePreferences: formStylePreferences.trim(),
    });
    onDone();
  }

  return (
    // scroll=false — this screen owns its own ScrollView (below) so the
    // Save button can sit OUTSIDE it as a fixed floating footer, the same
    // structural split RegistrationFlow's own Continue button uses, instead
    // of scrolling away at the bottom of a long list.
    <ScreenContainer edges={['top']} scroll={false} contentStyle={styles.flexFill}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDone} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('profile.editProfile')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.flexFill}
        contentContainerStyle={styles.scrollWrap}
        showsVerticalScrollIndicator={false}
      >
        <AccordionSection
          sectionKey="basicInfo"
          title={t('profile.sections.basicInfo')}
          isOpen={activeSection === 'basicInfo'}
          onToggle={toggleSection}
        >
          <FieldLabel>{t('profile.fields.gender')}</FieldLabel>
          <ChipSection options={GENDERS} value={formGender} onSelect={setFormGender} />

          <FieldLabel>{t('profile.fields.hairColor')}</FieldLabel>
          <ColorSwatchPicker
            options={getHairColorOptions(formGender)}
            value={formHairColor}
            onChange={setFormHairColor}
            swatchStyle="hair"
            columns={3}
            center
            showIllustration={false}
          />

          <FieldLabel>{t('profile.fields.eyeColor')}</FieldLabel>
          <ColorSwatchPicker
            options={EYE_COLORS}
            value={formEyeColor}
            onChange={setFormEyeColor}
            swatchStyle="eye"
            columns={3}
            center
          />

          <FieldLabel>{t('profile.fields.skinTone')}</FieldLabel>
          <ColorSwatchPicker
            options={SKIN_TONES}
            value={formSkinTone}
            onChange={setFormSkinTone}
            columns={3}
            center
          />

          <FieldLabel>{t('profile.fields.bodyShape')}</FieldLabel>
          {/* richCards — same centered, text-only card grid RegistrationFlow's
              bodyType step uses (see BodyShapeSelector's own comment): fixes
              both the old left-aligned chip row (no `center` prop existed for
              this component before) and the old tap-to-expand-an-illustration
              behavior in one move, since richCards never renders an image at
              all — just the shape name, and its description once selected. */}
          <BodyShapeSelector
            options={getBodyTypeOptions(formGender)}
            value={formBodyType}
            onChange={setFormBodyType}
            richCards
          />
        </AccordionSection>

        <AccordionSection
          sectionKey="bodyMeasurements"
          title={t('profile.sections.bodyMeasurements')}
          isOpen={activeSection === 'bodyMeasurements'}
          onToggle={toggleSection}
        >
          <FieldLabel>{t('profile.sections.heightWeight')}</FieldLabel>
          <UnitToggle value={formUnitSystem} onChange={setFormUnitSystem} t={t} />
          <View style={styles.hwRow}>
            <MeasurementField
              value={formHeight}
              onChangeText={(text) => setFormHeight(filterDigits(text))}
              unit={t(formUnitSystem === 'metric' ? 'common.units.cm' : 'common.units.ft')}
            />
            <MeasurementField
              value={formWeight}
              onChangeText={(text) => setFormWeight(filterDigits(text))}
              unit={t(formUnitSystem === 'metric' ? 'common.units.kg' : 'common.units.lbs')}
            />
          </View>

          <View style={styles.sectionDivider} />

          <NumberRow
            label={t('profile.fields.shoulders')}
            value={formShoulders}
            onChangeText={(text) => setFormShoulders(filterDigits(text))}
          />
          <NumberRow
            label={t('profile.fields.chest')}
            value={formChest}
            onChangeText={(text) => setFormChest(filterDigits(text))}
          />
          <NumberRow
            label={t('profile.fields.waist')}
            value={formWaist}
            onChangeText={(text) => setFormWaist(filterDigits(text))}
          />
          <NumberRow
            label={t('profile.fields.hips')}
            value={formHips}
            onChangeText={(text) => setFormHips(filterDigits(text))}
            last
          />
        </AccordionSection>

        <AccordionSection
          sectionKey="stylePreferences"
          title={t('profile.sections.stylePreferences')}
          isOpen={activeSection === 'stylePreferences'}
          onToggle={toggleSection}
        >
          <FieldLabel>{t('profile.sections.styleVibes')}</FieldLabel>
          <Text style={styles.helperText}>{t('profile.styleVibes.helper')}</Text>
          <StyleVibeSection t={t} selected={styleVibes} onToggle={toggleStyleVibe} />

          <FieldLabel>{t('profile.fields.styleNotes')}</FieldLabel>
          <TextInput
            style={styles.textArea}
            value={formStylePreferences}
            onChangeText={setFormStylePreferences}
            onFocus={scrollFieldIntoView}
            placeholder={t('onboarding.stylePreferencesStep.placeholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </AccordionSection>
      </ScrollView>

      <TouchableOpacity
        style={[buttons.primary, styles.saveBtn, { marginBottom: Math.max(insets.bottom, spacing.sm) }]}
        onPress={handleSave}
        activeOpacity={0.85}
      >
        <Text style={buttons.primaryText}>{t('profile.save')}</Text>
      </TouchableOpacity>
    </ScreenContainer>
  );
}

// One collapsible section — same raised white card treatment cards get
// everywhere else in the app (WardrobeScreen's bento tiles, ScanSheet),
// which this screen never had before, now doubling as the accordion's own
// tap target. The whole header row (title + chevron) is one TouchableOpacity
// so there's no small hidden hotspot. Chevron rotates 90° open/closed
// instead of swapping icons, so the state reads as a continuous motion
// rather than a jump-cut.
//
// Open/close used to be a plain conditional mount driven by LayoutAnimation
// — that's a documented no-op on react-native-web, and this app always runs
// as web (Telegram Mini App WebView), so every expand/collapse actually
// snapped instantly: the client felt "thrown" straight to whatever the new
// scroll position happened to be, with everything below the card jumping
// with zero transition. Body content now stays mounted (its natural height
// is measured once via onLayout, off in the very first, still-collapsed
// render) and a real Animated.Value smoothly interpolates height + opacity
// between 0 and that measured height on every toggle — this works
// identically on native and web, unlike LayoutAnimation. `pointerEvents`
// is still gated on `isOpen` so a collapsed section's (still-mounted)
// inputs can't be tapped or tabbed into.
function AccordionSection({ sectionKey, title, isOpen, onToggle, children }) {
  const [measuredHeight, setMeasuredHeight] = useState(null);
  const hasSnappedRef = useRef(false);
  const animatedHeight = useRef(new Animated.Value(0)).current;
  const animatedOpacity = useRef(new Animated.Value(0)).current;
  // Chevron rotation rides its own Animated.Value (not tied to measured
  // height at all) so it can start animating immediately on tap — no
  // reason to wait on layout measurement for a rotation that doesn't
  // depend on content size.
  const animatedChevron = useRef(new Animated.Value(isOpen ? 1 : 0)).current;

  function handleBodyLayout(event) {
    const height = event.nativeEvent.layout.height;
    if (height <= 0 || height === measuredHeight) return;
    setMeasuredHeight(height);
    if (!hasSnappedRef.current) {
      // First real measurement — snap straight to the correct resting
      // state (this may be the section that's open by default) instead of
      // animating from 0, which would otherwise play an unwanted "grow"
      // animation on initial mount.
      hasSnappedRef.current = true;
      animatedHeight.setValue(isOpen ? height : 0);
      animatedOpacity.setValue(isOpen ? 1 : 0);
    }
  }

  useEffect(() => {
    Animated.timing(animatedChevron, {
      toValue: isOpen ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (!hasSnappedRef.current || measuredHeight == null) return;
    Animated.parallel([
      Animated.timing(animatedHeight, {
        toValue: isOpen ? measuredHeight : 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(animatedOpacity, {
        toValue: isOpen ? 1 : 0,
        duration: isOpen ? 220 : 160,
        delay: isOpen ? 70 : 0,
        useNativeDriver: false,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, measuredHeight]);

  const chevronRotation = animatedChevron.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.accordionHeader}
        onPress={() => onToggle(sectionKey)}
        activeOpacity={0.7}
      >
        <Text style={styles.cardTitle}>{title}</Text>
        <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
          <Feather name="chevron-right" size={20} color={colors.textSecondary} />
        </Animated.View>
      </TouchableOpacity>
      <Animated.View
        style={{ height: animatedHeight, opacity: animatedOpacity, overflow: 'hidden' }}
        pointerEvents={isOpen ? 'auto' : 'none'}
      >
        <View style={styles.accordionBody} onLayout={handleBodyLayout}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

// Metric/imperial segmented toggle — same visual language and same
// display-only scope as RegistrationFlow's own measurements step (see that
// file's own comment on `unitSystem`): switching the label the height/weight
// fields show (cm/kg vs ft/lbs) without converting whatever number is
// already typed in.
function UnitToggle({ value, onChange, t }) {
  return (
    <View style={styles.unitToggleWrap}>
      {UNIT_SYSTEMS.map((system) => {
        const isSelected = value === system;
        const label =
          system === 'metric'
            ? `${t('common.units.cm')} / ${t('common.units.kg')}`
            : `${t('common.units.ft')} / ${t('common.units.lbs')}`;
        return (
          <TouchableOpacity
            key={system}
            style={[styles.unitToggleOption, isSelected && styles.unitToggleOptionSelected]}
            onPress={() => onChange(system)}
            activeOpacity={0.8}
          >
            <Text style={[styles.unitToggleText, isSelected && styles.unitToggleTextSelected]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// A field's own name within a card (e.g. "Hair Color" above its swatch
// grid) — smaller than the card title, but still bold/centered, so the
// centered-title language RegistrationFlow uses doesn't suddenly break
// halfway down a card into old-style left-aligned captions.
function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function ChipSection({ options, value, onSelect }) {
  const { t } = useTranslation();
  return (
    <View style={styles.chipWrap}>
      {options.map((option) => {
        const isSelected = value === option;
        return (
          <TouchableOpacity
            key={option}
            style={[styles.chip, isSelected && styles.chipSelected]}
            onPress={() => onSelect(option)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
              {t(`onboarding.options.${option}`, option)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Multi-select (up to MAX_STYLE_VIBES), commits to the store immediately on
// tap via `toggleStyleVibe` — unlike every other field on this screen, this
// one isn't gated behind the Save button below. Once the cap is reached,
// remaining unselected chips grey out further (still tappable to remove a
// selected one) rather than silently no-op-ing on tap.
function StyleVibeSection({ t, selected, onToggle }) {
  const atCap = selected.length >= MAX_STYLE_VIBES;
  return (
    <View style={styles.chipWrap}>
      {STYLE_VIBES.map((vibe) => {
        const isSelected = selected.includes(vibe);
        const disabled = !isSelected && atCap;
        return (
          <TouchableOpacity
            key={vibe}
            style={[styles.chip, isSelected && styles.chipSelected, disabled && styles.chipDisabled]}
            onPress={() => onToggle(vibe)}
            disabled={disabled}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
              {t(`profile.styleVibes.${vibe}`)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Height/weight — boxed, centered, big numeral input + unit, 2-up in one
// row. Same visual DNA as RegistrationFlow's own measurements step (bold
// 24px numeral, bottom-border field) rather than the old bare
// label-left/value-right hairline row, just laid out side by side instead
// of stacked — this is a browsable settings card among several others, not
// a single full-screen question, so the more compact 2-up arrangement fits
// the context better while still looking like the same design system.
function MeasurementField({ value, onChangeText, unit }) {
  return (
    <View style={styles.hwField}>
      <TextInput
        style={styles.hwInput}
        value={value}
        onChangeText={onChangeText}
        onFocus={scrollFieldIntoView}
        keyboardType="numeric"
        maxLength={3}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.hwUnit}>{unit}</Text>
    </View>
  );
}

function NumberRow({ label, value, onChangeText, last }) {
  return (
    <View style={[styles.numberRow, last && styles.numberRowLast]}>
      <Text style={styles.numberLabel}>{label}</Text>
      <TextInput
        style={styles.numberInput}
        value={value}
        onChangeText={onChangeText}
        onFocus={scrollFieldIntoView}
        keyboardType="numeric"
        maxLength={3}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // `flex: 1` + `textAlign: 'center'` — true center between the two equal-
  // width (40px) flanking slots, same mechanism RegistrationFlow's header
  // uses for its progress bar to keep the back chevron and close button
  // pinned to the true screen edges.
  headerTitle: { ...typography.title, flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800' },

  scrollWrap: { paddingBottom: spacing.xl },

  // No padding of its own — `accordionHeader` and `accordionBody` (below)
  // each carry their own, so the header keeps a consistent tap target
  // whether the section is open or closed instead of the whole card's
  // padding jumping when content mounts/unmounts. `overflow: 'hidden'`
  // keeps the header's touch ripple/highlight clipped to the card's own
  // rounded corners.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardLg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadows.soft,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  accordionBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  cardTitle: {
    ...typography.h2,
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
  },
  // Metric/imperial segmented toggle — identical shape/values to
  // RegistrationFlow's own measurements step, per that flow being the
  // explicit visual reference for this control.
  unitToggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  unitToggleOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  unitToggleOptionSelected: { backgroundColor: colors.inverseBackground },
  unitToggleText: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
  unitToggleTextSelected: { color: colors.inverseText },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },

  // Chips — same pill shape/fill RegistrationFlow's gender step uses:
  // centered wrap, ink fill on select, no `space-between` skew when a row
  // doesn't fill evenly.
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  chipSelected: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  chipDisabled: { opacity: opacity.disabled },
  chipText: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  chipTextSelected: { color: colors.inverseText },

  // Stacked (was side-by-side) and centered per user feedback — height
  // above weight, both centered under each other rather than as a 2-up row.
  hwRow: { flexDirection: 'column', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  hwField: { alignItems: 'center' },
  hwInput: {
    minWidth: 90,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: spacing.xs,
    // Web-only — react-native-web forwards unrecognized style keys like
    // `cursor` straight to the underlying DOM node's CSS. Without it the
    // hand/pointer cursor from an ancestor Pressable's own hover style can
    // bleed onto a plain text field, when a normal desktop text-input
    // I-beam cursor is what should show here on hover.
    cursor: 'text',
  },
  hwUnit: { fontSize: 12.5, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.xs },

  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  numberRowLast: { borderBottomWidth: 0 },
  numberLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  numberInput: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
    minWidth: 60,
    cursor: 'text', // see hwInput's own comment
  },
  textArea: {
    width: '100%',
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.sm,
    color: colors.textPrimary,
    // 16px, not 15 — under 16px is what triggers iOS Safari's auto-zoom-
    // on-focus on a real <input>, independent of the viewport meta tag's
    // own maximum-scale/user-scalable.
    fontSize: 16,
    lineHeight: 22,
    cursor: 'text', // see hwInput's own comment
  },

  // Floating footer — width/centering matches RegistrationFlow's own
  // Continue button (`width: '90%'`, `alignSelf: 'center'`, overriding
  // `buttons.primary`'s own `width: '100%'` since this style object is
  // spread AFTER it in the array below).
  saveBtn: { width: '90%', alignSelf: 'center', marginTop: spacing.sm },
});
