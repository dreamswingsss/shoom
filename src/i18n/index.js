import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from '../locales/ru.json';

// Russian-only — no in-app language switch (see ProfileScreen, which no
// longer renders a language section) and no per-device/per-account override.
i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
  },
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
});

export default i18n;
