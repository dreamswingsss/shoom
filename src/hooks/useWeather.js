import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { useWeatherStore } from '../store/useWeatherStore';

const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

// Open-Meteo's WMO weather codes collapsed into the handful of condition
// buckets the UI actually distinguishes (icon + translated label) — see
// https://open-meteo.com/en/docs for the full code table.
function describeWeatherCode(code) {
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  return 'unknown';
}

async function fetchCurrentWeather(latitude, longitude) {
  const response = await fetch(
    `${WEATHER_ENDPOINT}?latitude=${latitude}&longitude=${longitude}&current_weather=true`
  );
  if (!response.ok) throw new Error(`Weather request failed (${response.status})`);

  const payload = await response.json();
  const current = payload?.current_weather;
  if (!current || typeof current.temperature !== 'number') {
    throw new Error('Weather response missing current_weather');
  }

  return { temperature: Math.round(current.temperature), condition: describeWeatherCode(current.weathercode) };
}

// Forward-geocodes a typed city name to coordinates. Tries expo-location's
// native geocoder first (device-only, no extra network round-trip on iOS/
// Android); its web shim always throws ("Geocoder service is not available
// for this device"), so this transparently falls back to Open-Meteo's own
// free geocoding API — same provider as the weather call, no key needed —
// whenever the native geocoder is unavailable or fails for any reason.
async function geocodeCity(cityName) {
  try {
    const results = await Location.geocodeAsync(cityName);
    if (results?.[0]) {
      return { latitude: results[0].latitude, longitude: results[0].longitude };
    }
  } catch (err) {
    // Falls through to the HTTP geocoder below.
  }

  const response = await fetch(`${GEOCODING_ENDPOINT}?name=${encodeURIComponent(cityName)}&count=1`);
  if (!response.ok) throw new Error(`Geocoding request failed (${response.status})`);

  const payload = await response.json();
  const first = payload?.results?.[0];
  if (!first) throw new Error(`Could not find "${cityName}".`);

  return { latitude: first.latitude, longitude: first.longitude };
}

const INITIAL_STATE = { status: 'loading', temperature: null, city: null, condition: null };

// Foreground location -> reverse geocode -> Open-Meteo current weather, no
// API key required — unless the client has typed in a manual city override
// (persisted in useWeatherStore, e.g. to work around a VPN or an imprecise
// device location), in which case that city is forward-geocoded instead and
// GPS/permissions are skipped entirely. Degrades to `{ status: 'error' }` on
// a denied permission, a location failure, or a bad/failed fetch — callers
// should treat that the same way regardless of which of those it was, since
// none of them leave enough data to render a real forecast.
export function useWeather() {
  const manualCity = useWeatherStore((state) => state.manualCity);
  const setManualCity = useWeatherStore((state) => state.setManualCity);
  const clearManualCity = useWeatherStore((state) => state.clearManualCity);
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function loadFromDevice() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Location permission denied');
      }

      const position = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = position.coords;

      // A failed reverse-geocode (e.g. the same web-shim limitation
      // geocodeCity() works around above) shouldn't fail the whole widget —
      // it only costs the city label, which WeatherWidget already falls
      // back to a translated "your area" for.
      let city = null;
      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        const place = places?.[0];
        city = place?.city || place?.subregion || place?.region || place?.country || null;
      } catch (err) {
        city = null;
      }

      const weather = await fetchCurrentWeather(latitude, longitude);
      return { ...weather, city };
    }

    async function loadFromManualCity() {
      const { latitude, longitude } = await geocodeCity(manualCity);
      const weather = await fetchCurrentWeather(latitude, longitude);
      return { ...weather, city: manualCity };
    }

    async function load() {
      setState(INITIAL_STATE);
      try {
        const result = manualCity ? await loadFromManualCity() : await loadFromDevice();
        if (!cancelled) setState({ status: 'ready', ...result });
      } catch (err) {
        if (__DEV__) {
          console.warn('[useWeather] Falling back to unavailable state:', err.message);
        }
        if (!cancelled) {
          setState({ status: 'error', temperature: null, city: null, condition: null });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [manualCity]);

  // Called by the manual-city modal's "Apply". Validates the city resolves
  // *before* persisting it, so a typo can't clobber a working GPS-based
  // forecast — the effect above then re-fires (its dependency includes
  // `manualCity`) and re-does the same lookup for real; a small duplicate
  // request in exchange for one single writer of `state`, instead of this
  // function and the effect racing to set it independently.
  const submitManualCity = useCallback(
    async (cityName) => {
      const trimmed = cityName.trim();
      if (!trimmed) throw new Error('Enter a city name.');

      const { latitude, longitude } = await geocodeCity(trimmed);
      await fetchCurrentWeather(latitude, longitude);

      setManualCity(trimmed);
    },
    [setManualCity]
  );

  return { ...state, manualCity, submitManualCity, clearManualCity };
}
