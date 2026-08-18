// Support contact + legal document links — surfaced in ProfileScreen's
// "Документы и поддержка" section and in telegram-bot-webhook's welcome
// message, per the payment provider's own review requirement (bank
// explicitly rejected a group chat as the support channel; wants a
// personal contact plus permanently-reachable Privacy Policy / Terms).
//
// PRIVACY_POLICY_URL/TERMS_OF_SERVICE_URL are `null` until the user
// publishes the drafted text on telegra.ph and hands back the real links —
// every call site treats `null` as "not published yet" (see
// legal.linkUnavailable in ru.json) rather than crashing on a missing URL.
export const SUPPORT_TELEGRAM_USERNAME = 'shoom_help';
export const SUPPORT_URL = `https://t.me/${SUPPORT_TELEGRAM_USERNAME}`;

export const PRIVACY_POLICY_URL = 'https://telegra.ph/Politika-konfidencialnosti-08-18-78';
export const TERMS_OF_SERVICE_URL = 'https://telegra.ph/Polzovatelskoe-soglashenie-08-18-25';
