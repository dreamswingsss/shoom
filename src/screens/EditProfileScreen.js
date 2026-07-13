import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { colors, spacing, radius, opacity, buttons, typography } from '../theme/tokens';
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

function toInputString(value) {
  return value != null ? String(value) : '';
}

export default function EditProfileScreen({ onDone }) {
  const { t } = useTranslation();
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
  const [formShoulders, setFormShoulders] = useState(toInputString(measurements?.shoulders));
  const [formChest, setFormChest] = useState(toInputString(measurements?.chest));
  const [formWaist, setFormWaist] = useState(toInputString(measurements?.waist));
  const [formHips, setFormHips] = useState(toInputString(measurements?.hips));
  const [formStylePreferences, setFormStylePreferences] = useState(stylePreferences || '');

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
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDone} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('profile.editProfile')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ChipSection
        label={t('profile.fields.gender')}
        options={GENDERS}
        value={formGender}
        onSelect={setFormGender}
      />
      <ColorSwatchPicker
        label={t('profile.fields.hairColor')}
        options={getHairColorOptions(formGender)}
        value={formHairColor}
        onChange={setFormHairColor}
        swatchStyle="hair"
      />
      <ColorSwatchPicker
        label={t('profile.fields.eyeColor')}
        options={EYE_COLORS}
        value={formEyeColor}
        onChange={setFormEyeColor}
        swatchStyle="eye"
      />
      <ColorSwatchPicker
        label={t('profile.fields.skinTone')}
        options={SKIN_TONES}
        value={formSkinTone}
        onChange={setFormSkinTone}
      />
      <BodyShapeSelector
        label={t('profile.fields.bodyShape')}
        options={getBodyTypeOptions(formGender)}
        value={formBodyType}
        onChange={setFormBodyType}
      />

      <NumberRow
        label={`${t('profile.fields.height')} (cm)`}
        value={formHeight}
        onChangeText={(text) => setFormHeight(filterDigits(text))}
      />
      <NumberRow
        label={`${t('profile.fields.weight')} (kg)`}
        value={formWeight}
        onChangeText={(text) => setFormWeight(filterDigits(text))}
      />

      <Text style={styles.sectionLabel}>{t('profile.sections.bodyMeasurements')}</Text>
      <NumberRow
        label={`${t('profile.fields.shoulders')} (cm)`}
        value={formShoulders}
        onChangeText={(text) => setFormShoulders(filterDigits(text))}
      />
      <NumberRow
        label={`${t('profile.fields.chest')} (cm)`}
        value={formChest}
        onChangeText={(text) => setFormChest(filterDigits(text))}
      />
      <NumberRow
        label={`${t('profile.fields.waist')} (cm)`}
        value={formWaist}
        onChangeText={(text) => setFormWaist(filterDigits(text))}
      />
      <NumberRow
        label={`${t('profile.fields.hips')} (cm)`}
        value={formHips}
        onChangeText={(text) => setFormHips(filterDigits(text))}
      />

      <StyleVibeSection t={t} selected={styleVibes} onToggle={toggleStyleVibe} />

      <Text style={styles.sectionLabel}>{t('profile.sections.stylePreferences')}</Text>
      <TextInput
        style={styles.textArea}
        value={formStylePreferences}
        onChangeText={setFormStylePreferences}
        placeholder={t('onboarding.stylePreferencesStep.placeholder')}
        placeholderTextColor={colors.textMuted}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
        <Text style={styles.saveBtnText}>{t('profile.save')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ChipSection({ label, options, value, onSelect }) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
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
    <View style={styles.section}>
      <View style={styles.styleVibesHeader}>
        <Text style={styles.sectionLabel}>{t('profile.sections.styleVibes')}</Text>
        <Text style={styles.styleVibesHelper}>{t('profile.styleVibes.helper')}</Text>
      </View>
      <View style={styles.chipWrap}>
        {STYLE_VIBES.map((vibe) => {
          const isSelected = selected.includes(vibe);
          const disabled = !isSelected && atCap;
          return (
            <TouchableOpacity
              key={vibe}
              style={[styles.vibeChip, isSelected && styles.vibeChipSelected, disabled && styles.vibeChipDisabled]}
              onPress={() => onToggle(vibe)}
              disabled={disabled}
              activeOpacity={0.8}
            >
              <Text style={[styles.vibeChipText, isSelected && styles.vibeChipTextSelected]}>
                {t(`profile.styleVibes.${vibe}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function NumberRow({ label, value, onChangeText }) {
  return (
    <View style={styles.numberRow}>
      <Text style={styles.numberLabel}>{label}</Text>
      <TextInput
        style={styles.numberInput}
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
        maxLength={3}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, padding: spacing.sm, paddingBottom: spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.title },

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
  },
  chipSelected: { backgroundColor: colors.inverseBackground, borderColor: colors.inverseBackground },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: colors.inverseText },

  styleVibesHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  styleVibesHelper: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  // Unselected: grey-on-grey (Quiet Luxury default state). Selected: the
  // same ink-fill/paper-text inversion every other selected chip on this
  // screen uses, so Style Vibes doesn't introduce a second visual language.
  vibeChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vibeChipSelected: { backgroundColor: colors.inverseBackground },
  vibeChipDisabled: { opacity: opacity.disabled },
  vibeChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  vibeChipTextSelected: { color: colors.inverseText },

  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
    minHeight: 50,
  },
  numberLabel: { fontSize: 14, color: colors.textSecondary },
  numberInput: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    minWidth: 60,
  },

  textArea: {
    width: '100%',
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },

  saveBtn: { ...buttons.primary },
  saveBtnText: { ...buttons.primaryText },
});
