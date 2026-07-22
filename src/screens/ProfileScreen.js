import { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Animated, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import { useWardrobeStore } from '../store/useWardrobeStore';
import { usePlannerStore, getStyleStreak } from '../store/usePlannerStore';
import { calculateCohesionScore } from '../utils/wardrobeUtils';
import { supabase } from '../services/supabaseClient';
import { deleteAccount } from '../services/accountService';
import { useFadeOnFocus } from '../hooks/useFadeOnFocus';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
import { colors, cardTints, spacing, radius, shadows, hairline, typography, buttons } from '../theme/tokens';
import EditProfileScreen from './EditProfileScreen';
import ScreenContainer from '../components/ScreenContainer';
import LanguagePicker from '../components/LanguagePicker';
import { getInitials } from '../utils/getInitials';

// Redesign v3 — Profile is a scannable vertical list (avatar row, a stats
// card, then icon nav rows) instead of the old stacked-sections layout.
// The mockup's nav rows (Notifications, Style Vibes, Fit Profile, Wear
// History, Language & Region) each open their own screen there; this app
// doesn't have Notifications or Wear History as real features yet, so
// those two stay stubs (an alert) while Style Vibes/Fit Profile expand
// the same data the old layout showed inline, and Language & Region wires
// straight into the existing LanguagePicker modal.
export default function ProfileScreen({ navigation, route }) {
  const { t } = useTranslation();
  const isLoggedIn = useUserStore((state) => state.isLoggedIn);
  const user = useUserStore((state) => state.user);
  const gender = useUserStore((state) => state.gender);
  const hairColor = useUserStore((state) => state.hairColor);
  const eyeColor = useUserStore((state) => state.eyeColor);
  const skinTone = useUserStore((state) => state.skinTone);
  const bodyType = useUserStore((state) => state.bodyType);
  const measurements = useUserStore((state) => state.measurements);
  const stylePreferences = useUserStore((state) => state.stylePreferences);
  const styleVibes = useUserStore((state) => state.styleVibes);
  const resetAppTour = useUserStore((state) => state.resetAppTour);
  const fadeOpacity = useFadeOnFocus();

  const wardrobe = useWardrobeStore((state) => state.items);
  const fetchWardrobe = useWardrobeStore((state) => state.fetchWardrobe);
  const scheduledOutfits = usePlannerStore((state) => state.scheduledOutfits);
  const fetchOutfits = usePlannerStore((state) => state.fetchOutfits);
  const styleStreak = useMemo(() => getStyleStreak(scheduledOutfits), [scheduledOutfits]);
  const cohesionScore = useMemo(() => calculateCohesionScore(wardrobe), [wardrobe]);

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Deferred Registration guest CTA — same shared flow as ScanSheet's
  // Save-to-Closet auth prompt (see useGoogleSignIn.js). No extra branching
  // needed here after signIn() resolves: it already restores/persists
  // gender, fetches the profile, and logs in — isLoggedIn flips reactively
  // and this whole screen re-renders showing the real profile on its own.
  const { signIn: signInWithGoogle, signingIn, error: googleSignInError } = useGoogleSignIn();
  // Which nav row's content is expanded in place below it — see the file
  // comment above for why this is an accordion instead of real navigation.
  const [expandedSection, setExpandedSection] = useState(null);

  // Profile is the app's initial tab (TabNavigator's initialRouteName), so
  // unlike the stats these back, wardrobe/outfits may never have been
  // fetched yet if the client hasn't visited Closet/Planner this session —
  // same idempotent fetch-on-mount pattern WardrobeScreen uses.
  useEffect(() => {
    fetchWardrobe();
    fetchOutfits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // StylistScreen's AI Stylist Guard "Complete Profile" CTA hands off here
  // via a route param (`navigation.navigate('Profile', { openEditProfile:
  // true })`) rather than any shared "should I be editing" state — same
  // pre-filled-then-cleared param pattern StylistScreen itself uses for
  // `initialPrompt`/`targetItem`. Cleared right after so navigating back to
  // this tab later (without the param) doesn't re-open edit mode on its own.
  useEffect(() => {
    if (!route?.params?.openEditProfile) return;
    setIsEditing(true);
    navigation.setParams({ openEditProfile: undefined });
  }, [route?.params?.openEditProfile]);

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
  // Dev-only "Reset App Tour" button's handler — WardrobeScreen's own
  // tour-launch effect is gated on `hasSeenAppTour` (what `resetAppTour`
  // flips back to false), so calling that alone from HERE — Profile — used
  // to spotlight the tour's first step directly on top of whatever tab was
  // already visible (Profile). React Navigation's bottom-tabs keeps every
  // tab screen mounted after its first visit, just toggled `display:none`
  // while unfocused — a `display:none` view has no valid on-screen frame,
  // so AppTour's own `measureInWindow` had nothing real to measure until
  // the client manually switched to Closet themselves. Navigating there
  // FIRST, and only flipping `hasSeenAppTour` a frame later (once that tab
  // switch has actually committed and WardrobeScreen's own TourTargets are
  // laid out and visible), is what makes the tour restart exactly the way
  // a fresh guest would see it — always from Closet, never mid-navigation.
  function handleResetAppTour() {
    navigation.navigate('Closet');
    requestAnimationFrame(() => {
      resetAppTour();
    });
  }

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
              // `err.message` is now the REAL server-side reason (see
              // accountService.js's own extractFunctionErrorMessage), not
              // the generic "non-2xx status code" text — logged here too
              // so it shows up in Metro/device logs even if the client
              // dismisses the alert without reading it.
              console.log('[handleDeleteAccount] failed:', err.message);
              Alert.alert(t('profile.deleteAccount.errorTitle'), err.message);
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  }

  function toggleSection(key) {
    setExpandedSection((current) => (current === key ? null : key));
  }

  function showComingSoon(titleKey, messageKey) {
    Alert.alert(t(titleKey), t(messageKey));
  }

  const hasMeasurements =
    measurements && Object.values(measurements).some((value) => value !== null && value !== undefined);

  if (isEditing) {
    return <EditProfileScreen onDone={() => setIsEditing(false)} />;
  }

  return (
    // scroll=false — this screen's fade-on-focus needs a real Animated.
    // ScrollView (opacity bound to fadeOpacity), which ScreenContainer's own
    // plain ScrollView can't provide. contentStyle zeroes the shell's 16px
    // margin out since `container` below already carries that same
    // spacing.screenH padding on the real scrollable content, one layer in.
    <ScreenContainer edges={['top']} scroll={false} contentStyle={styles.zeroHPadding}>
      <Animated.ScrollView
        contentContainerStyle={[styles.container, { paddingTop: spacing.sm }]}
        style={{ opacity: fadeOpacity }}
      >
        {/* Guest: not tappable — there's no account yet for "Edit Profile"
            to write to, and no email to show. Name/subtitle swap to a
            generic "Guest" line pointing at the CTA card right below
            instead of pretending this row edits anything.
            No longer an App Tour target — Profile isn't part of the
            walkthrough anymore (the tour stays scoped to Closet, Planner,
            and AI Stylist), so the `TourTarget`/`profileHeaderTarget`
            wrapping this row that used to exist for that step's spotlight
            was removed along with it. `profileHeaderOuter` still carries
            the row's own marginBottom. */}
        <View style={styles.profileHeaderOuter}>
          <TouchableOpacity
            style={styles.profileHeader}
            onPress={isLoggedIn ? () => setIsEditing(true) : undefined}
            disabled={!isLoggedIn}
            activeOpacity={isLoggedIn ? 0.7 : 1}
          >
            {isLoggedIn && user?.photo ? (
              <Image source={{ uri: user.photo }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                {isLoggedIn ? (
                  <Text style={styles.avatarFallbackText}>{getInitials(user?.name)}</Text>
                ) : (
                  <Feather name="user" size={26} color={colors.textMuted} />
                )}
              </View>
            )}
            <View style={styles.headerTextWrap}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {isLoggedIn ? user?.name || t('profile.unknownUser') : t('profile.guest.name')}
                </Text>
                {isLoggedIn && <Feather name="chevron-right" size={14} color={colors.textMuted} />}
              </View>
              <Text style={styles.email} numberOfLines={1}>
                {isLoggedIn ? user?.email || '' : t('profile.guest.subtitle')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* The one CTA every other guest-facing entry point (ScanSheet's
            Save-to-Closet gate, Color DNA's calibration sheet) eventually
            routes back to — this is Profile's own standalone way in,
            without needing to scan an item or open Color DNA first. */}
        {!isLoggedIn && (
          <View style={styles.guestCtaCard}>
            <LinearGradient colors={[colors.violet, colors.violetLight]} style={styles.guestCtaIconWrap}>
              <Feather name="user-plus" size={22} color={colors.inverseText} />
            </LinearGradient>
            <Text style={styles.guestCtaTitle}>{t('profile.guest.ctaTitle')}</Text>
            <Text style={styles.guestCtaMessage}>{t('profile.guest.ctaMessage')}</Text>

            {googleSignInError && (
              <Text style={styles.guestCtaError}>
                {googleSignInError.message || t('closet.scan.authPrompt.genericError')}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.guestGoogleBtn, signingIn && styles.guestGoogleBtnDisabled]}
              onPress={signInWithGoogle}
              disabled={signingIn}
              activeOpacity={0.85}
            >
              {signingIn ? (
                <ActivityIndicator size="small" color={colors.inverseText} />
              ) : (
                <>
                  <MaterialCommunityIcons name="google" size={18} color={colors.inverseText} />
                  <Text style={styles.guestGoogleBtnText}>{t('closet.scan.authPrompt.googleButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.statsRowCard}>
          <StatCell icon="grid" value={wardrobe.length} label={t('profile.stats.items')} />
          <View style={styles.statCellDivider} />
          <StatCell icon="zap" value={styleStreak} label={t('profile.stats.dayStreak')} />
          <View style={styles.statCellDivider} />
          <StatCell icon="star" value={`${cohesionScore}%`} label={t('profile.stats.capsuleScore')} />
        </View>

        <View style={styles.navListCard}>
          <NavRow
            iconWrapStyle={styles.navIconWrapViolet}
            icon={<Feather name="bell" size={16} color={colors.violet} />}
            label={t('profile.nav.notifications')}
            onPress={() => showComingSoon('profile.comingSoon.title', 'profile.comingSoon.notifications')}
          />
          <NavRow
            iconWrapStyle={styles.navIconWrapCoral}
            icon={<Feather name="star" size={16} color={colors.coral} />}
            label={t('profile.sections.styleVibes')}
            expanded={expandedSection === 'styleVibes'}
            onPress={() => toggleSection('styleVibes')}
          />
          {expandedSection === 'styleVibes' && (
            <View style={styles.expandPanel}>
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

              <Text style={styles.expandLabel}>{t('profile.sections.stylePreferences')}</Text>
              <Text style={[styles.stylePreferencesText, !stylePreferences && styles.notSetText]}>
                {stylePreferences || t('profile.notSet')}
              </Text>
            </View>
          )}

          <NavRow
            iconWrapStyle={styles.navIconWrapSky}
            icon={<Feather name="user" size={16} color={colors.sky} />}
            label={t('profile.sections.fitProfile')}
            expanded={expandedSection === 'fitProfile'}
            onPress={() => toggleSection('fitProfile')}
          />
          {expandedSection === 'fitProfile' && (
            <View style={styles.expandPanel}>
              <InfoRow label={t('profile.fields.gender')} value={gender} />
              <InfoRow label={t('profile.fields.hairColor')} value={hairColor} />
              <InfoRow label={t('profile.fields.eyeColor')} value={eyeColor} />
              <InfoRow label={t('profile.fields.skinTone')} value={skinTone} />
              <InfoRow label={t('profile.fields.bodyShape')} value={bodyType} last={!hasMeasurements} />

              {hasMeasurements && (
                <>
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
                </>
              )}
            </View>
          )}

          <NavRow
            iconWrapStyle={styles.navIconWrapSage}
            icon={<Feather name="clock" size={16} color={colors.sage} />}
            label={t('profile.nav.wearHistory')}
            onPress={() => showComingSoon('profile.comingSoon.title', 'profile.comingSoon.wearHistory')}
          />
          <LanguagePicker
            renderTrigger={(open) => (
              <NavRow
                last
                iconWrapStyle={styles.navIconWrapViolet}
                icon={<Feather name="globe" size={16} color={colors.violet} />}
                label={t('profile.nav.languageRegion')}
                onPress={open}
              />
            )}
          />
        </View>

        {/* Guest: none of these apply — no account to edit, no session to
            end, nothing to delete. The guestCtaCard above is this screen's
            one action for a guest instead. */}
        {isLoggedIn && (
          <>
            <View style={styles.actionsWrap}>
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
            </View>

            {/* Deliberately a plain, subdued text link rather than another
                full danger pill — logoutBtn above already owns that visual
                weight, and an irreversible, App Store-mandated action like
                this shouldn't read as equally prominent/tappable as a
                routine sign-out. */}
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
          </>
        )}

        {/* TEMPORARY — dev-only escape hatch (see useUserStore's own
            `resetAppTour` comment). `hasSeenAppTour` persists to
            AsyncStorage, so without this the only way to see App Tour again
            after it's run once — including a run during development/
            testing — is clearing app storage or reinstalling. Visible
            regardless of isLoggedIn: the tour itself only ever runs for a
            guest on an empty Closet, so gating this behind a signed-in-only
            block would make it useless for the one case that needs it. */}
        {__DEV__ && (
          <TouchableOpacity style={styles.devResetTourBtn} onPress={handleResetAppTour} activeOpacity={0.7}>
            <Text style={styles.devResetTourBtnText}>{t('profile.devResetAppTour')}</Text>
          </TouchableOpacity>
        )}
      </Animated.ScrollView>
    </ScreenContainer>
  );
}

function StatCell({ icon, value, label }) {
  return (
    <View style={styles.statCell}>
      <Feather name={icon} size={17} color={colors.violet} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// One row of the nav-list card. `expanded` (only passed by the two rows
// that accordion open in place — Style Vibes/Fit Profile) swaps the
// trailing chevron for an up/down state, matching the existing
// WardrobeScreen `EditableRow` convention elsewhere in the app; rows
// without real content behind them (Notifications, Wear History, Language)
// keep a plain forward chevron.
function NavRow({ iconWrapStyle, icon, label, onPress, expanded, last }) {
  const showsExpandState = expanded !== undefined;
  return (
    <TouchableOpacity
      style={[styles.navRow, !last && hairline]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={iconWrapStyle}>{icon}</View>
      <Text style={styles.navRowLabel}>{label}</Text>
      <Feather
        name={showsExpandState ? (expanded ? 'chevron-up' : 'chevron-down') : 'chevron-right'}
        size={14}
        color={colors.textMuted}
      />
    </TouchableOpacity>
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
  // Cancels ScreenContainer's own 16px shell padding — `container` below
  // applies that same spacing.screenH itself, one layer in, on the real
  // scrollable content.
  zeroHPadding: { paddingHorizontal: 0 },
  // Top padding comes from the inline `paddingTop` (fixed post-safe-area
  // gap) passed alongside this style above.
  container: { paddingHorizontal: spacing.screenH, paddingBottom: spacing.screenBottom },

  profileHeaderOuter: { marginBottom: spacing.md },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: radius.avatarLg,
    backgroundColor: colors.surface,
    ...shadows.avatarLg,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: radius.avatarLg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.avatarLg,
  },
  avatarFallbackText: { color: colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headerTextWrap: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...typography.title, flexShrink: 1 },
  email: { ...typography.bodySecondary },

  // Guest sign-in CTA — same violet-gradient-icon + title + subtitle shape
  // as ScanSheet's authPromptWrap and Onboarding's old auth step, so this
  // reads as the same "create your account" moment wherever it shows up.
  guestCtaCard: {
    backgroundColor: cardTints.violet,
    borderWidth: 1,
    borderColor: cardTints.violetBorder,
    borderRadius: radius.cardLg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  guestCtaIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.cardLg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 5,
  },
  guestCtaTitle: { ...typography.title, fontSize: 17, textAlign: 'center', marginBottom: 4 },
  guestCtaMessage: {
    ...typography.bodySecondary,
    fontSize: 13.5,
    textAlign: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  guestCtaError: {
    fontSize: 12.5,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  guestGoogleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    width: '100%',
    backgroundColor: colors.inverseBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    ...shadows.accent,
  },
  guestGoogleBtnDisabled: { opacity: 0.6 },
  guestGoogleBtnText: { ...buttons.primaryText, fontSize: 14.5 },

  statsRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
    ...shadows.soft,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 5 },
  statValue: { ...typography.title, fontSize: 15 },
  statLabel: { ...typography.caption },
  statCellDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.border },

  navListCard: {
    backgroundColor: colors.glassCard,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.soft,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  navRowLabel: { ...typography.rowTitle, flex: 1 },
  navIconWrapViolet: {
    width: 32,
    height: 32,
    borderRadius: radius.iconWrap,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cardTints.violet,
  },
  navIconWrapCoral: {
    width: 32,
    height: 32,
    borderRadius: radius.iconWrap,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cardTints.coral,
  },
  navIconWrapSky: {
    width: 32,
    height: 32,
    borderRadius: radius.iconWrap,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cardTints.sky,
  },
  navIconWrapSage: {
    width: 32,
    height: 32,
    borderRadius: radius.iconWrap,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cardTints.sage,
  },

  // Accordion content for the Style Vibes / Fit Profile rows — sits inside
  // the same nav-list card, directly under the row it belongs to.
  expandPanel: { paddingBottom: spacing.sm },
  expandLabel: { ...typography.label, marginTop: spacing.sm, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  rowLabel: { ...typography.captionSecondary },
  rowValue: { ...typography.rowTitle },
  stylePreferencesText: { ...typography.body },
  notSetText: { ...typography.bodySecondary, color: colors.textMuted },
  vibeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vibeChip: {
    backgroundColor: cardTints.violet,
    borderWidth: 1,
    borderColor: cardTints.violetBorder,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  vibeChipText: { ...typography.tag, color: colors.violet },

  actionsWrap: { gap: 10, marginBottom: spacing.xs },
  // Redesign v3 — solid violet fill (was an outlined `buttons.secondary`)
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
    ...shadows.accent,
    shadowOpacity: 0.25,
  },
  editBtnText: { ...buttons.primaryText },
  logoutBtn: {
    width: '100%',
    backgroundColor: colors.dangerBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: { ...buttons.primaryText, color: colors.danger },
  deleteAccountBtn: {
    alignSelf: 'center',
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 20,
    justifyContent: 'center',
  },
  deleteAccountBtnText: {
    ...typography.captionSecondary,
    color: colors.danger,
    textDecorationLine: 'underline',
  },
  devResetTourBtn: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  devResetTourBtnText: {
    ...typography.captionSecondary,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
