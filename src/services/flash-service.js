// The one-shot confirmation shown after a redirect.
//
// A form that posts and redirects leaves the reader on a page that looks
// exactly like the one they left, with no way to tell whether what they did
// worked. That is most acute right after the identity verification capture:
// the modal closes, the page reloads, and the only evidence is a status pill
// several rows down that they were not looking at.
//
// Messages are a fixed catalogue keyed by a short token carried in the query
// string. Nothing the caller supplies is ever rendered — a query string is
// attacker-controllable, and a flash that echoed it would put chosen words in
// the product's own voice at the top of somebody else's screen.

const MESSAGES = Object.freeze({
  'admin-verified': {
    tone: 'success',
    icon: 'idcheck',
    title: 'Your profile is verified.',
    body: 'Administrator identity validated for this organization.',
    ms: 5000
  },
  'admin-verification-pending': {
    tone: 'info',
    icon: 'idcheck',
    title: 'Verification submitted.',
    body: 'The capture did not reach the confidence needed to validate automatically.',
    ms: 6000
  }
});

/**
 * The flash for this request, or null.
 *
 * `ms` is how long it stays. Long enough to read a sentence, short enough not
 * to sit over the page — and the element carries a close button, so a reader
 * who wants it gone sooner is not waiting on a timer.
 */
function flashFor(query = {}) {
  const key = String(query.flash || '');
  const message = Object.prototype.hasOwnProperty.call(MESSAGES, key) ? MESSAGES[key] : null;
  return message ? { ...message } : null;
}

module.exports = { flashFor, MESSAGES };
