import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { useUserStore } from '../store/useUserStore';

import en from '../locales/en.json';
import es from '../locales/es.json';
import it from '../locales/it.json';
import pt from '../locales/pt.json';
import fr from '../locales/fr.json';
import de from '../locales/de.json';
import ru from '../locales/ru.json';

// Language names are always shown in their own language regardless of the
// app's current language (standard convention — "Français" reads the same
// whether the app is in English or German), so these don't go through t().
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
];
const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

const LANGUAGE_STORAGE_KEY = '@app_language';

// First-launch default: the device's own language if we ship a translation
// for it, else English — resolved once at module load, before init(), so
// the very first render (no stored preference yet) already matches the
// device instead of always starting in English. A previously-picked
// language (stored below) always overrides this once the client has one.
//
// MVP scope cut — not called below for this release (see the hard-coded
// `lng: 'en'` in init() instead): kept, unused, rather than deleted, so
// re-enabling device-language detection later is a one-line swap back.
// eslint-disable-next-line no-unused-vars
function getDeviceLanguage() {
  const deviceCode = getLocales()[0]?.languageCode;
  return SUPPORTED_CODES.includes(deviceCode) ? deviceCode : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    it: { translation: it },
    pt: { translation: pt },
    fr: { translation: fr },
    de: { translation: de },
    ru: { translation: ru },
  },
  // MVP scope cut — English-only for this release regardless of device
  // language (was `getDeviceLanguage()`; see that function's own comment).
  // WelcomeStyleQuiz's language step is commented out of its `steps` array
  // for the same reason — restoring both is the intended path back to
  // multilingual onboarding, not a permanent removal.
  lng: 'en',
  // English stays the fallback regardless of device language — the brief
  // for this app is Western-audience-first, so any string missing from a
  // translation file (or a future language we add without full coverage
  // yet) still reads in English rather than falling through to a mix of
  // languages or raw keys.
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Restores a previously-picked language before the app renders anything —
// App.js awaits this alongside font loading so the UI never flashes the
// device-detected language before switching to what the client explicitly
// chose last time. If they've never chosen one, the device-language default
// set above (or English, if the device's language isn't one we ship) stands.
export const i18nReady = AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((storedLanguage) => {
  if (storedLanguage && storedLanguage !== i18n.language) {
    return i18n.changeLanguage(storedLanguage);
  }
});

// The one place both OnboardingScreen's language step (via
// useSettingsStore.setLanguage) and Profile's LanguagePicker (direct call)
// funnel through — so syncing to `public.users.language` here, once, covers
// every way the client can change language without either call site needing
// its own Supabase write.
export async function setAppLanguage(code) {
  await i18n.changeLanguage(code);
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  useUserStore.getState().syncLanguage(code);
}

export default i18n;
