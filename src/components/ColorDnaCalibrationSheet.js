import { useEffect, useState } from 'react';
import { Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import BottomSheet from './BottomSheet';
import ColorSwatchPicker from './ColorSwatchPicker';
import { useUserStore } from '../store/useUserStore';
import { getHairColorOptions, EYE_COLORS, SKIN_TONES } from '../constants/profileOptions';
import { colors, spacing, radius, typography, buttons } from '../theme/tokens';

// Progressive Profiling for Color DNA — Deferred Registration stopped
// collecting hairColor/eyeColor/skinTone at Onboarding (see
// OnboardingScreen.js), so WardrobeScreen shows this instead of
// ColorDnaModal's real results the first time any client (guest or
// signed-in) opens the tile with any of those three still unset. Styled
// like Onboarding's own color-swatch steps (same ColorSwatchPicker) rather
// than inventing new UI for the same picker. All three fields are collected
// in one screen rather than three separate steps — a deliberate change from
// Onboarding's one-question-per-step pacing, since this is a top-up for
// someone already using the app, not a first impression to pace out.
export default function ColorDnaCalibrationSheet({ visible, onClose }) {
  const { t } = useTranslation();
  const gender = useUserStore((state) => state.gender);
  const updateColorDna = useUserStore((state) => state.updateColorDna);

  const [hairColorValue, setHairColorValue] = useState(null);
  const [eyeColorValue, setEyeColorValue] = useState(null);
  const [skinToneValue, setSkinToneValue] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setHairColorValue(null);
      setEyeColorValue(null);
      setSkinToneValue(null);
      setSaving(false);
    }
  }, [visible]);

  const ready = Boolean(hairColorValue && eyeColorValue && skinToneValue);

  async function handleSave() {
    if (!ready || saving) return;

    setSaving(true);
    try {
      // updateColorDna local-sets immediately (WardrobeScreen's
      // needsColorDnaCalibration flips false on its own reactive selectors,
      // swapping this sheet for the real ColorDnaModal on the very next
      // render) and, if a session exists, persists to Supabase in the same
      // call — see that action's own comment for the guest case.
      await updateColorDna({ hairColor: hairColorValue, eyeColor: eyeColorValue, skinTone: skinToneValue });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="92%">
      <ScrollView contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.iconWrap}>
          <Feather name="droplet" size={26} color={colors.inverseText} />
        </LinearGradient>
        <Text style={styles.title}>{t('closet.hub.colorDna.calibration.title')}</Text>
        <Text style={styles.subtitle}>{t('closet.hub.colorDna.calibration.subtitle')}</Text>

        <ColorSwatchPicker
          label={t('onboarding.steps.hairColor')}
          options={getHairColorOptions(gender)}
          value={hairColorValue}
          onChange={setHairColorValue}
          swatchStyle="hair"
          disabled={saving}
        />
        <ColorSwatchPicker
          label={t('onboarding.steps.eyeColor')}
          options={EYE_COLORS}
          value={eyeColorValue}
          onChange={setEyeColorValue}
          swatchStyle="eye"
          disabled={saving}
        />
        <ColorSwatchPicker
          label={t('onboarding.steps.skinTone')}
          options={SKIN_TONES}
          value={skinToneValue}
          onChange={setSkinToneValue}
          swatchStyle="flat"
          disabled={saving}
        />

        <TouchableOpacity
          style={[buttons.primary, !ready && buttons.disabled, styles.saveBtn]}
          onPress={handleSave}
          disabled={!ready || saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.inverseText} />
          ) : (
            <Text style={buttons.primaryText}>{t('closet.hub.colorDna.calibration.saveButton')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, alignItems: 'center' },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.cardLg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  title: { ...typography.h2, fontSize: 19, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: {
    ...typography.bodySecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  saveBtn: { width: '100%', marginTop: spacing.xs },
});
