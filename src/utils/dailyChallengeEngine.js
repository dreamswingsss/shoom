// "Smart Daily Target" — generates a personalized styling challenge from the
// client's Fit Profile (color type via colorDna, body shape) and today's
// weather, instead of a static rotating list. Pure, deterministic MVP logic
// (no network round-trip) — swapping this for a real Gemini call later is a
// drop-in: send the same profile/weather fields in a prompt asking for
// `{ icon, title }` JSON, and return that instead of the local lookup below.
import { getPalette } from './colorDna';

// colorDna.js's `name` fields (Navy, Emerald, ...) are internal matching
// keys shared with calculateColorDnaMatch's substring match against
// AI-extracted item colors — translating them there would silently break
// that matching. This is a display-only lookup just for this tile's
// Russian title, decoupled from the matching logic entirely.
const COLOR_NAME_RU = {
  Navy: 'тёмно-синий',
  Emerald: 'изумрудный',
  'Soft Rose': 'нежно-розовый',
  Lavender: 'лавандовый',
  Terracotta: 'терракотовый',
  Mustard: 'горчичный',
  Cream: 'кремовый',
  Olive: 'оливковый',
};

// Deterministic per calendar day (not per render) — every re-render of the
// widget within the same day sees the same target; it only changes at local
// midnight, same cadence as the old static list.
function getDayIndex(date = new Date()) {
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - startOfYear) / 86400000);
}

const BODY_SHAPE_TARGETS = {
  Hourglass: { icon: 'target', title: 'Подчеркните талию сегодня — это выгодно для фигуры «Песочные часы»' },
  'Pear (Triangle)': { icon: 'target', title: 'Наденьте структурированный верх сегодня — он уравновесит фигуру «Груша»' },
  'Apple (Round)': { icon: 'target', title: 'Попробуйте открытый слой сегодня — он вытянет силуэт' },
  Rectangle: { icon: 'target', title: 'Подчеркните талию сегодня — это добавит фигуре изгибов' },
  'Inverted Triangle': { icon: 'target', title: 'Наденьте низ пошире сегодня — он уравновесит плечи' },
  Trapezoid: { icon: 'target', title: 'Выберите приталенный силуэт сегодня — он подойдёт вашей сбалансированной фигуре' },
  Triangle: { icon: 'target', title: 'Наденьте структурированные плечи сегодня — это уравновесит фигуру' },
  Oval: { icon: 'target', title: 'Попробуйте монохромный образ сегодня — он вытянет силуэт' },
};

const WEATHER_TARGETS = {
  clear: (temp) =>
    temp != null && temp >= 24
      ? { icon: 'sun', title: 'Оденьтесь легче сегодня — без лишнего слоя в такую жару' }
      : { icon: 'sun', title: 'Сегодня ясно — хороший день для любимых кроссовок' },
  cloudy: () => ({ icon: 'cloud', title: 'Возьмите лёгкую куртку сегодня — погода может измениться' }),
  rain: () => ({ icon: 'umbrella', title: 'Наденьте непромокаемую обувь сегодня — ожидается дождь' }),
  snow: () => ({ icon: 'cloud-snow', title: 'Одевайтесь теплее сегодня — пора доставать самую тёплую верхнюю одежду' }),
  storm: () => ({ icon: 'cloud-lightning', title: 'Возьмите настоящее пальто сегодня — надвигается непогода' }),
  fog: () => ({ icon: 'cloud', title: 'Добавьте яркий акцент сегодня — выделитесь в тумане' }),
};

// Used only when neither a color-type nor a body-shape signal is available
// yet (e.g. onboarding not finished) and weather hasn't resolved either.
const FALLBACK_TARGETS = [
  { icon: 'droplet', title: 'Наденьте что-нибудь синее сегодня' },
  { icon: 'grid', title: 'Попробуйте монохромный образ сегодня' },
  { icon: 'refresh-cw', title: 'Наденьте сегодня незаслуженно забытую вещь' },
  { icon: 'plus-circle', title: 'Добавьте один аксессуар сегодня' },
  { icon: 'layers', title: 'Скомбинируйте сегодня два неожиданных предмета' },
];

// Picks between a Color DNA target, a body-shape target, and a weather
// target — whichever are actually available — rotating deterministically by
// day so the tile doesn't always lean on the same signal. `isCompleted`
// always starts `false`: this function only decides *what* today's target
// is, not whether the client already did it — that's tracked separately
// (usePlannerStore.scheduledOutfits, keyed by date: "done" means the client
// actually planned today's outfit) so the target and its completion state
// stay independent.
export function generateDailyChallenge(userProfile = {}, weather = {}) {
  const dayIndex = getDayIndex();
  const signals = [];

  const palette = getPalette(userProfile.skinTone, userProfile.hairColor, userProfile.eyeColor);
  if (palette?.best?.length) {
    const color = palette.best[dayIndex % palette.best.length];
    const colorNameRu = COLOR_NAME_RU[color.name] || color.name;
    signals.push({ icon: 'star', title: `Наденьте сегодня что-то ${colorNameRu} — это ваш цвет по Color DNA` });
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
