import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUserStore } from '../store/useUserStore';

import en from '../locales/en.json';
import es from '../locales/es.json';
import it from '../locales/it.json';
import pt from '../locales/pt.json';
import fr from '../locales/fr.json';
import de from '../locales/de.json';

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
];

const LANGUAGE_STORAGE_KEY = '@app_language';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    it: { translation: it },
    pt: { translation: pt },
    fr: { translation: fr },
    de: { translation: de },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Restores a previously-picked language before the app renders anything —
// App.js awaits this alongside font loading so the UI never flashes English
// before switching to the saved language.
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
