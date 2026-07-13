-- Closes the last gap in the profile-sync migration: the app's language
-- preference (Onboarding's language step + the LanguagePicker in Profile
-- settings, both funneling through src/i18n/index.js's setAppLanguage())
-- was previously local-only (useSettingsStore + a raw AsyncStorage key),
-- never written to `public.users`.
alter table public.users
  add column language text;
