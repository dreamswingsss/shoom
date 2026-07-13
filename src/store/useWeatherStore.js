import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persists the client's manually-entered city (Weather Widget's pencil-edit
// override) so a VPN or an imprecise device location doesn't silently win
// again on the next app launch — once set, useWeather() prefers this over
// GPS until the client clears it.
export const useWeatherStore = create(
  persist(
    (set) => ({
      manualCity: null,
      setManualCity: (city) => set({ manualCity: city }),
      clearManualCity: () => set({ manualCity: null }),
    }),
    {
      name: 'weather-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
