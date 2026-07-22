// Shared low-level Gemini client used by every AI service in the app
// (aiChatEngine, aiScanner, aiStylist). Centralizes the API key, the
// request/response plumbing, and the model-fallback carousel so each
// service only has to describe *what* to ask Gemini, not how to survive a
// 429.

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Priority-ordered model fallback chain. Each Gemini model has its own,
// independent free-tier quota (Google AI Studio grants quota per model, not
// per project) — so when a testing surge exhausts the primary model's
// quota, retrying the identical request against the next model here gets a
// fresh quota pool instead of failing outright. All three are current
// (mid-2026) stable, GA models in the 2.5 family and all support
// multimodal (vision) input. gemini-1.5-flash/-pro are deliberately not
// used — Google retired the 1.x line ahead of this date.
export const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

// Thrown by fetchWithFallback only when every model in FALLBACK_MODELS came
// back rate-limited. Callers catch this specific error to decide their own
// graceful-degradation response — each AI feature needs a different shape
// (a chat message vs. a scan-result object vs. an outfit list), so that
// decision stays in the caller rather than being baked in here.
export class GeminiRateLimitError extends Error {
  constructor() {
    super('All fallback models are currently rate-limited.');
    this.name = 'GeminiRateLimitError';
  }
}

// Thrown when Gemini rejects a request with its own "User location is not
// supported for the API use." error — a geo-restriction on the API
// key/account tied to the request's originating IP (observed to flicker on
// and off e.g. behind a VPN), not a per-model quota issue. Distinct from
// GeminiRateLimitError so callers can degrade instead of cycling
// FALLBACK_MODELS for it (see isLocationRestrictedError below — every model
// shares the same account-level restriction, so retrying the next one in
// the chain would just fail identically).
export class GeminiLocationRestrictedError extends Error {
  constructor() {
    super('User location is not supported for the API use.');
    this.name = 'GeminiLocationRestrictedError';
  }
}

function buildGeminiEndpoint(model) {
  return `${GEMINI_API_BASE}/${model}:generateContent`;
}

// True only for quota/rate-limit failures — the one case where trying the
// next model in FALLBACK_MODELS can actually help. Any other error (bad
// API key, malformed request, network outage) fails identically on every
// model, so those propagate immediately instead of cycling the whole chain.
function isRateLimitError(err) {
  if (err?.status === 429) return true;
  const haystack = `${err?.geminiStatus || ''} ${err?.message || ''}`.toLowerCase();
  return (
    haystack.includes('resource_exhausted') || haystack.includes('quota') || haystack.includes('rate limit')
  );
}

// Matches Gemini's own "User location is not supported for the API use."
// error text (usually a 400 with geminiStatus FAILED_PRECONDITION).
function isLocationRestrictedError(err) {
  const haystack = `${err?.message || ''}`.toLowerCase();
  return haystack.includes('user location is not supported');
}

async function callGemini(model, requestBody) {
  let response;
  try {
    response = await fetch(buildGeminiEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error('Network error while contacting Gemini. Check your connection and try again.');
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || `Gemini request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.geminiStatus = payload?.error?.status;
    throw error;
  }

  return payload;
}

// Calls Gemini's generateContent endpoint, cycling through FALLBACK_MODELS
// whenever a model comes back rate-limited.
//
// `requestBody` must already contain `contents` (and any `generationConfig`
// overrides); `systemInstruction`, if given, is attached as Gemini's native
// `systemInstruction` field rather than folded into `contents` — keep the
// caller's actual ask (the image, the user's message, …) in `contents` and
// put static grounding/instructions here.
//
// Resolves with the raw parsed Gemini response payload. Throws the
// original error immediately for anything that isn't rate-limiting;
// throws GeminiRateLimitError once every model in the chain has been
// rate-limited.
export async function fetchWithFallback(requestBody, systemInstruction) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'Missing Gemini API key. Set EXPO_PUBLIC_GEMINI_API_KEY in .env and restart the dev server.'
    );
  }

  const body = systemInstruction
    ? { ...requestBody, systemInstruction: { parts: [{ text: systemInstruction }] } }
    : requestBody;

  for (const model of FALLBACK_MODELS) {
    try {
      return await callGemini(model, body);
    } catch (err) {
      if (isLocationRestrictedError(err)) {
        // Account/API-key-level restriction, not a per-model quota — every
        // other model in the chain would fail with the exact same error, so
        // there's nothing to gain from cycling through them.
        throw new GeminiLocationRestrictedError();
      }
      if (!isRateLimitError(err)) {
        throw err;
      }
      console.warn(`[gemini] "${model}" hit its rate limit, switching model...`);
    }
  }

  throw new GeminiRateLimitError();
}
