// Builds one outbound message: subject, HTML, text and SMS, in one locale.
//
// This is the only place that knows a catalogue exists. `deliverMessage` asks
// for a message by type and locale and gets back the four parts; it does not
// know which language it is sending, which is what keeps the locale decision
// in one place rather than at every call site.
//
// An unknown type throws. A locale with no catalogue cannot happen —
// i18n-service only ever returns a supported one — but the lookup still falls
// back to the default rather than throwing, because failing to send a
// sign-in code is worse than sending it in English.

const { DEFAULT_LOCALE, SUPPORTED_LOCALES } = require('../services/i18n-service');
const { renderEmail } = require('./render');

const CATALOGUES = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, require(`./catalogue/${locale}`)])
);

/** Every message type the platform can send, in catalogue order. */
function messageTypes() {
  return Object.keys(CATALOGUES[DEFAULT_LOCALE].messages);
}

function catalogueFor(locale) {
  return CATALOGUES[locale] || CATALOGUES[DEFAULT_LOCALE];
}

/**
 * One rendered message.
 *
 * `variables` are whatever the caller has — a code, a URL, an expiry. `brand`
 * and `organizationName` come from the sending context, so a message sent on
 * an organization's behalf says who it is from in its own footer.
 */
function buildMessage({ type, locale = DEFAULT_LOCALE, variables = {}, brand, baseUrl = '', organizationName = '', supportEmail = '' }) {
  const catalogue = catalogueFor(locale);
  const definition = catalogue.messages[type];
  if (!definition) {
    throw new Error(`Unknown message type: ${type}`);
  }

  const vars = { ...variables, brand };
  const common = catalogue.common;
  const year = new Date().getFullYear();

  // The footer says who sent it before it says not to reply. An organization
  // sending through the shared platform mailbox has to be named there, or the
  // reader has a message from "Aegis ID" about an organization they know by
  // another name.
  //
  // Not when the name is the brand's own: "Sent by Aegis ID on behalf of
  // Aegis ID" is what a caller with no organization branding produced, and
  // it reads as a bug because it is one.
  const onBehalf = organizationName && organizationName !== brand;
  const footerNote = [
    onBehalf ? common.onBehalfOf({ brand, organizationName }) : '',
    supportEmail ? common.support({ supportEmail }) : ''
  ].filter(Boolean).join(' ');

  const { html, text } = renderEmail({
    blocks: definition.blocks(vars),
    brand,
    baseUrl,
    locale,
    footerNote,
    strings: {
      preview: definition.preview(vars),
      automated: common.automated({ brand }),
      copyright: common.copyright({ year })
    }
  });

  return {
    locale,
    subject: definition.subject(vars),
    preview: definition.preview(vars),
    html,
    text,
    sms: definition.sms(vars)
  };
}

module.exports = { buildMessage, messageTypes, CATALOGUES };
