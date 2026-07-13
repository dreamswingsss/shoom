import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAppLanguage } from '../i18n';

// App-level settings, separate from the fit profile (useUserStore) — today
// just the language the client picked on OnboardingScreen's first step, but
// the natural home for future global prefs.
export const useSettingsStore = create(
  persist(
    (set) => ({
      language: null,
      hasSelectedLanguage: false,

      setLanguage: (langCode) => {
        // i18n.js owns actually switching i18next + persisting the raw code
        // for `i18nReady` to restore on the next launch; this store only
        // keeps its own record of "the client has explicitly picked one".
        setAppLanguage(langCode);
        set({ language: langCode, hasSelectedLanguage: true });
      },
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
