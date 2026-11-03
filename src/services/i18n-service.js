// Which language a message is written in.
//
// Two locales, both Canadian: en-CA and fr-CA. They are listed explicitly
// rather than derived from whatever files happen to exist, because a missing
// catalogue should be a startup failure rather than a silent fall back to
// English for a French recipient.
//
// Resolution order, first supported wins:
//
//   1. the locale stored on the account, if the person has chosen one
//   2. the Accept-Language the browser sent on the request that triggered it
//   3. en-CA
//
// A message sent with no request in hand — a scheduled notice, a webhook —
// has only the first and the third, which is why the stored preference
// matters: it is the only thing that survives having no browser present.

const DEFAULT_LOCALE = 'en-CA';
const SUPPORTED_LOCALES = ['en-CA', 'fr-CA'];

/** The locale's language subtag, lowercased: en-CA -> en. */
function languageOf(locale) {
  return String(locale || '').toLowerCase().split('-')[0];
}

/**
 * The supported locale that best matches one candidate, or null.
 *
 * Matches on the language rather than the full tag, so `fr`, `fr-FR` and
 * `fr-ca` all reach fr-CA. A French speaker in France gets French; refusing
 * them because the region differs would be worse than the regional spelling
 * being slightly off.
 */
function matchLocale(candidate) {
  const wanted = String(candidate || '').trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === wanted);
  if (exact) {
    return exact;
  }
  const language = languageOf(wanted);
  return SUPPORTED_LOCALES.find((locale) => languageOf(locale) === language) || null;
}

/**
 * Parse an Accept-Language header into candidate tags, best first.
 *
 * q-values are honoured because a browser set to French with English as a
 * fallback sends both, and taking the first tag in the list would be right
 * only by accident.
 */
function parseAcceptLanguage(header) {
  return String(header || '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((param) => param.trim().match(/^q=([\d.]+)$/))
        .find(Boolean);
      return { tag: tag.trim(), q: q ? Number(q[1]) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((left, right) => right.q - left.q)
    .map((entry) => entry.tag);
}

/** The first supported locale among the candidates, else en-CA. */
function resolveLocale(...candidates) {
  for (const candidate of candidates.flat()) {
    const matched = matchLocale(candidate);
    if (matched) {
      return matched;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * The locale for a message to this person, triggered by this request.
 *
 * `user.locale` is a stored preference and wins, because it is the only
 * signal that is still true when the message is sent an hour later by a
 * background job. A request's Accept-Language is a decent guess about the
 * browser in front of us and nothing more.
 */
function localeForUser(user, req) {
  return resolveLocale(
    user?.locale,
    req ? parseAcceptLanguage(req.get?.('accept-language')) : [],
    DEFAULT_LOCALE
  );
}

/** The locale this request should be rendered in. */
function localeForRequest(req) {
  return resolveLocale(
    req?.user?.locale,
    parseAcceptLanguage(req?.get?.('accept-language')),
    DEFAULT_LOCALE
  );
}

/** Normalize a stored value, dropping anything unsupported. */
function normalizeLocale(value) {
  return matchLocale(value) || '';
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  languageOf,
  localeForRequest,
  localeForUser,
  matchLocale,
  normalizeLocale,
  parseAcceptLanguage,
  resolveLocale
};
