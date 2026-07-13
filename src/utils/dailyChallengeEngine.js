// "Smart Daily Target" — generates a personalized styling challenge from the
// client's Fit Profile (color type via colorDna, body shape) and today's
// weather, instead of a static rotating list. Pure, deterministic MVP logic
// (no network round-trip) — swapping this for a real Gemini call later is a
// drop-in: send the same profile/weather fields in a prompt asking for
// `{ icon, title }` JSON, and return that instead of the local lookup below.
import { getPalette } from './colorDna';

// Deterministic per calendar day (not per render) — every re-render of the
// widget within the same day sees the same target; it only changes at local
// midnight, same cadence as the old static list.
function getDayIndex(date = new Date()) {
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - startOfYear) / 86400000);
}

const BODY_SHAPE_TARGETS = {
  Hourglass: { icon: 'target', title: "Cinch your waist today — it flatters your Hourglass shape" },
  'Pear (Triangle)': { icon: 'target', title: 'Try a structured top today — it balances your Pear shape' },
  'Apple (Round)': { icon: 'target', title: 'Try an open layer today — it elongates your silhouette' },
  Rectangle: { icon: 'target', title: 'Try a cinched waist today — it adds curve to your frame' },
  'Inverted Triangle': { icon: 'target', title: 'Try a wider-leg bottom today — it balances your shoulders' },
  Trapezoid: { icon: 'target', title: 'Try a fitted silhouette today — it suits your balanced frame' },
  Triangle: { icon: 'target', title: 'Try a structured shoulder today — it balances your frame' },
  Oval: { icon: 'target', title: 'Try a monochrome outfit today — it elongates your line' },
};

const WEATHER_TARGETS = {
  clear: (temp) =>
    temp != null && temp >= 24
      ? { icon: 'sun', title: 'Go light today — skip the extra layer in the heat' }
      : { icon: 'sun', title: 'Clear skies today — a good day for your favorite sneakers' },
  cloudy: () => ({ icon: 'cloud', title: 'Layer a light jacket today — the sky could turn' }),
  rain: () => ({ icon: 'umbrella', title: 'Wear waterproof shoes today — rain is in the forecast' }),
  snow: () => ({ icon: 'cloud-snow', title: 'Bundle up today — your warmest outerwear is calling' }),
  storm: () => ({ icon: 'cloud-lightning', title: 'Grab a real coat today — storms are rolling in' }),
  fog: () => ({ icon: 'cloud', title: 'Add one bright accent today — stand out in the fog' }),
};

// Used only when neither a color-type nor a body-shape signal is available
// yet (e.g. onboarding not finished) and weather hasn't resolved either.
const FALLBACK_TARGETS = [
  { icon: 'droplet', title: 'Wear something blue today' },
  { icon: 'grid', title: 'Try a monochrome outfit today' },
  { icon: 'refresh-cw', title: 'Rewear a hidden gem today' },
  { icon: 'plus-circle', title: 'Add one accessory today' },
  { icon: 'layers', title: 'Layer two unexpected pieces today' },
];

// Picks between a Color DNA target, a body-shape target, and a weather
// target — whichever are actually available — rotating deterministically by
// day so the tile doesn't always lean on the same signal. `isCompleted`
// always starts `false`: this function only decides *what* today's target
// is, not whether the client already did it — that's tracked separately
// (usePlannerStore.completedChallenges, keyed by date) so the target and its
// completion state persist independently across app restarts on the same day.
export function generateDailyChallenge(userProfile = {}, weather = {}) {
  const dayIndex = getDayIndex();
  const signals = [];

  const palette = getPalette(userProfile.skinTone, userProfile.hairColor, userProfile.eyeColor);
  if (palette?.best?.length) {
    const color = palette.best[dayIndex % palette.best.length];
    signals.push({ icon: 'star', title: `Wear something ${color.name} today — it's in your Color DNA` });
  }

  if (userProfile.bodyType && BODY_SHAPE_TARGETS[userProfile.bodyType]) {
    signals.push(BODY_SHAPE_TARGETS[userProfile.bodyType]);
  }

  if (weather?.status === 'ready' && WEATHER_TARGETS[weather.condition]) {
    signals.push(WEATHER_TARGETS[weather.condition](weather.temperature));
  }

  const chosen =
    signals.length > 0 ? signals[dayIndex % signals.length] : FALLBACK_TARGETS[dayIndex % FALLBACK_TARGETS.length];

  return { icon: chosen.icon, title: chosen.title, isCompleted: false };
}
