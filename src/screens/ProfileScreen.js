import { useState } from 'react';
import { View, Text, Image, Animated, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { supabase } from '../services/supabaseClient';
import { deleteAccount } from '../services/accountService';
import { useFadeOnFocus } from '../hooks/useFadeOnFocus';
import { colors, cardTints, spacing, radius, shadows, hairline, typography } from '../theme/tokens';
import EditProfileScreen from './EditProfileScreen';
import LanguagePicker from '../components/LanguagePicker';
import { getInitials } from '../utils/getInitials';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useUserStore((state) => state.user);
  const gender = useUserStore((state) => state.gender);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const skinTone = useUserStore((state) => state.skinTone);
  const bodyType = useUserStore((state) => state.bodyType);
  const measurements = useUserStore((state) => state.measurements);
  const stylePreferences = useUserStore((state) => state.stylePreferences);
  const styleVibes = useUserStore((state) => state.styleVibes);
  const fadeOpacity = useFadeOnFocus();

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Ends the Supabase session rather than calling useUserStore's logout()
  // directly — useSupabaseAuthSync's onAuthStateChange listener reacts to
  // the resulting SIGNED_OUT event and clears the store from there, so this
  // and any other future sign-out entry point can't drift out of sync with
  // whether a real session still exists.
  function handleLogout() {
    supabase.auth.signOut();
  }

  // App Store Guideline 5.1.1(v) — irreversible, so this confirms once
  // before doing anything. accountService.deleteAccount() already calls
  // supabase.auth.signOut() as its last local step, which fires the same
  // SIGNED_OUT event handleLogout above relies on — useSupabaseAuthSync's
  // listener clears every store and App.js swaps this screen out for
  // OnboardingScreen on its own. Nothing to do here on success but let it
  // happen; isDeleting only needs resetting on the failure path.
  function handleDeleteAccount() {
    Alert.alert(
      t('profile.deleteAccount.confirmTitle'),
      t('profile.deleteAccount.confirmMessage'),
      [
        { text: t('profile.deleteAccount.cancel'), style: 'cancel' },
        {
          text: t('profile.deleteAccount.confirm'),
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteAccount();
            } catch (err) {
              Alert.alert(t('profile.deleteAccount.errorTitle'), err.message);
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  }

  const hasMeasurements =
    measurements && Object.values(measurements).some((value) => value !== null && value !== undefined);

  if (isEditing) {
    return <EditProfileScreen onDone={() => setIsEditing(false)} />;
  }

  return (
    <Animated.ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.sm }]}
      style={{ opacity: fadeOpacity, backgroundColor: colors.background }}
    >
      <View style={styles.headerRow}>
        <Text style={styles.header}>{t('profile.title')}</Text>
        <LanguagePicker />
      </View>

      <View style={styles.profileHeader}>
        {user?.photo ? (
          <Image source={{ uri: user.photo }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>{getInitials(user?.name)}</Text>
          </View>
        )}
        <Text style={styles.name}>{user?.name || t('profile.unknownUser')}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t('profile.sections.fitProfile')}</Text>
      <View style={styles.section}>
        <InfoRow label={t('profile.fields.gender')} value={gender} />
        <InfoRow label={t('profile.fields.hairColor')} value={hairColor} />
        <InfoRow label={t('profile.fields.eyeColor')} value={eyeColor} />
        <InfoRow label={t('profile.fields.skinTone')} value={skinTone} />
        <InfoRow label={t('profile.fields.bodyShape')} value={bodyType} last />
      </View>

      <Text style={styles.sectionTitle}>{t('profile.sections.bodyMeasurements')}</Text>
      {hasMeasurements ? (
        <View style={styles.section}>
          <InfoRow
            label={t('profile.fields.shoulders')}
            value={measurements.shoulders != null ? `${measurements.shoulders} cm` : null}
          />
          <InfoRow
            label={t('profile.fields.chest')}
            value={measurements.chest != null ? `${measurements.chest} cm` : null}
          />
          <InfoRow
            label={t('profile.fields.waist')}
            value={measurements.waist != null ? `${measurements.waist} cm` : null}
          />
          <InfoRow
            label={t('profile.fields.hips')}
            value={measurements.hips != null ? `${measurements.hips} cm` : null}
            last
          />
        </View>
      ) : (
        <Text style={styles.notSetText}>{t('profile.notSet')}</Text>
      )}

      <Text style={styles.sectionTitle}>{t('profile.sections.styleVibes')}</Text>
      {styleVibes && styleVibes.length > 0 ? (
        <View style={styles.vibeChipWrap}>
          {styleVibes.map((vibe) => (
            <View key={vibe} style={styles.vibeChip}>
              <Text style={styles.vibeChipText}>{t(`profile.styleVibes.${vibe}`, vibe)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.notSetText}>{t('profile.notSet')}</Text>
      )}

      <Text style={styles.sectionTitle}>{t('profile.sections.stylePreferences')}</Text>
      <Text style={[styles.stylePreferencesText, !stylePreferences && styles.notSetText]}>
        {stylePreferences || t('profile.notSet')}
      </Text>

      <TouchableOpacity style={styles.editBtn} onPress={() => setIsEditing(true)} activeOpacity={0.8}>
        <Text style={styles.editBtnText}>{t('profile.editProfile')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        disabled={isDeleting}
        activeOpacity={0.8}
      >
        <Text style={styles.logoutBtnText}>{t('profile.logOut')}</Text>
      </TouchableOpacity>

      {/* Deliberately a plain, subdued text link rather than another full
          danger pill — logoutBtn above already owns that visual weight, and
          an irreversible, App Store-mandated action like this shouldn't
          read as equally prominent/tappable as a routine sign-out. */}
      <TouchableOpacity
        style={styles.deleteAccountBtn}
        onPress={handleDeleteAccount}
        disabled={isDeleting}
        activeOpacity={0.7}
      >
        {isDeleting ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <Text style={styles.deleteAccountBtnText}>{t('profile.deleteAccount.button')}</Text>
        )}
      </TouchableOpacity>
    </Animated.ScrollView>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <View style={[styles.row, !last && hairline]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // `padding: spacing.md`'s top contribution is overridden by the inline
  // `paddingTop` (real safe-area inset) passed alongside this style above —
  // Yoga always resolves an explicit edge over the "all" shorthand.
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  header: { ...typography.h2, fontWeight: '800' },
  profileHeader: { alignItems: 'center', gap: 10, marginBottom: spacing.lg },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.surface,
  },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  name: { ...typography.title, fontWeight: '800' },
  email: { fontSize: 14, color: colors.textSecondary },
  sectionTitle: { ...typography.label, marginBottom: spacing.xs, marginTop: spacing.sm },
  section: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowLabel: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  rowValue: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
  stylePreferencesText: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  notSetText: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.md },
  vibeChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 28,
    marginBottom: 32,
  },
  vibeChip: {
    backgroundColor: cardTints.violet,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  vibeChipText: { fontSize: 12, fontWeight: '700', color: colors.violet },
  // Redesign v2 — solid violet fill (was an outlined `buttons.secondary`)
  // and a soft pink fill for Log out (was an outlined `buttons.danger`).
  // Defined locally rather than changing those shared tokens — several
  // other screens (Onboarding, ItemDetail, WardrobeScreen's discard button)
  // still rely on the outlined look for `buttons.secondary`/`buttons.danger`.
  editBtn: {
    width: '100%',
    backgroundColor: colors.violet,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    ...shadows.accent,
  },
  editBtnText: { fontFamily: typography.title.fontFamily, fontWeight: '700', color: colors.inverseText, fontSize: 15 },
  logoutBtn: {
    width: '100%',
    backgroundColor: '#FBE7E7',
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: { fontFamily: typography.title.fontFamily, fontWeight: '700', color: colors.danger, fontSize: 15 },
  deleteAccountBtn: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 20,
    justifyContent: 'center',
  },
  deleteAccountBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
    textDecorationLine: 'underline',
  },
});
