// Renders one message definition into the HTML and plain-text parts.
//
// Both come from the same block list, so the text alternative cannot drift
// from the HTML — every multipart message this platform has ever sent was
// plain text only, and the quickest way to end up with a stale text part is
// to maintain it by hand beside a template.
//
// The HTML is deliberately old-fashioned: tables for layout, every colour
// inline, no classes, no custom properties, no web fonts. Outlook on Windows
// renders through Word, which supports none of the modern layout the rest of
// this product is built on, and a CSS variable in an email resolves to
// nothing in most clients — the brand layer's whole mechanism is unavailable
// here. The palette below is therefore a copy of the tokens, by value, and
// `tests/email-templates.test.js` asserts it stays in step with
// brand-layer.css rather than trusting anyone to remember.

const PALETTE = {
  brand: '#0F75BC',
  brandOn: '#ffffff',
  brandSoft: '#e8f3fb',
  brandLine: '#b9d9ef',
  text: '#09090b',
  muted: '#5f5f6a',
  subtle: '#65656e',
  line: '#e4e4e7',
  surface: '#ffffff',
  bg: '#f4f4f5',
  warn: '#92400e',
  warnSoft: '#fffbeb',
  warnLine: '#fde68a'
};

// Saira and Inter are self-hosted on the site and cannot be used in mail, so
// the stack names what the reader is likely to already have and falls back
// through the usual system faces.
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One block as HTML.
 *
 * Every block is its own table row rather than a <p> with a margin, because
 * margin collapsing is the first thing Outlook gets wrong and spacing that
 * works everywhere has to be padding on a cell.
 */
function blockHtml(block) {
  const cell = (inner, pad = '0 0 16px') => `<tr><td style="padding:${pad}">${inner}</td></tr>`;

  switch (block.type) {
    case 'heading':
      return cell(
        `<h1 style="margin:0;font-family:${SANS};font-size:20px;line-height:1.3;`
        + `font-weight:600;color:${PALETTE.text}">${escapeHtml(block.text)}</h1>`,
        '0 0 12px'
      );

    case 'text':
      return cell(
        `<p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.6;`
        + `color:${PALETTE.text}">${escapeHtml(block.text)}</p>`
      );

    // A code is read off the screen and typed into another window, so it is
    // spaced, large and selectable text — never an image, which a reader
    // cannot copy and many clients refuse to load at all.
    case 'code':
      return cell(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`
        + `<tr><td align="center" style="padding:18px 12px;background:${PALETTE.brandSoft};`
        + `border:1px solid ${PALETTE.brandLine};border-radius:8px">`
        + `<span style="font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:.18em;`
        + `color:${PALETTE.text}">${escapeHtml(block.value)}</span>`
        + `</td></tr></table>`,
        '4px 0 18px'
      );

    // The button and the bare URL under it are one block on purpose: a
    // client that strips the anchor styling, or a reader forwarding the mail
    // to a device without it, still has something to copy.
    case 'button':
      return cell(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`
        + `<tr><td style="border-radius:6px;background:${PALETTE.brand}">`
        + `<a href="${escapeHtml(block.url)}" style="display:inline-block;padding:11px 22px;`
        + `font-family:${SANS};font-size:15px;font-weight:600;color:${PALETTE.brandOn};`
        + `text-decoration:none;border-radius:6px">${escapeHtml(block.label)}</a>`
        + `</td></tr></table>`
        + `<p style="margin:14px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;`
        + `color:${PALETTE.subtle};word-break:break-all">${escapeHtml(block.url)}</p>`,
        '4px 0 20px'
      );

    case 'meta':
      return cell(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" `
        + `style="border:1px solid ${PALETTE.line};border-radius:8px">`
        + block.rows.map(([key, value], index) =>
          `<tr><td style="padding:10px 14px;font-family:${SANS};font-size:13px;`
          + `color:${PALETTE.muted};${index ? `border-top:1px solid ${PALETTE.line};` : ''}`
          + `width:40%">${escapeHtml(key)}</td>`
          + `<td style="padding:10px 14px;font-family:${SANS};font-size:13px;font-weight:600;`
          + `color:${PALETTE.text};${index ? `border-top:1px solid ${PALETTE.line};` : ''}">`
          + `${escapeHtml(value)}</td></tr>`).join('')
        + `</table>`
      );

    case 'note':
      return cell(
        `<p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.6;`
        + `color:${PALETTE.muted}">${escapeHtml(block.text)}</p>`
      );

    case 'warn':
      return cell(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`
        + `<tr><td style="padding:12px 14px;background:${PALETTE.warnSoft};`
        + `border:1px solid ${PALETTE.warnLine};border-radius:8px;font-family:${SANS};`
        + `font-size:13px;line-height:1.6;color:${PALETTE.warn}">${escapeHtml(block.text)}</td>`
        + `</tr></table>`,
        '4px 0 16px'
      );

    default:
      return '';
  }
}

/** The same block as the plain-text alternative. */
function blockText(block) {
  switch (block.type) {
    case 'heading':
      return [block.text, '='.repeat(Math.min(block.text.length, 60))].join('\n');
    case 'text':
    case 'note':
      return block.text;
    case 'code':
      return `    ${block.value}`;
    case 'button':
      return `${block.label}:\n${block.url}`;
    case 'meta':
      return block.rows.map(([key, value]) => `${key}: ${value}`).join('\n');
    case 'warn':
      return block.text;
    default:
      return '';
  }
}

/**
 * The full message.
 *
 * `logoUrl` is absolute because a relative path in mail resolves against the
 * client, not against us. It is served from the deployment the message came
 * from, so an organization on its own hostname sends its own.
 */
function renderEmail({ blocks = [], brand, baseUrl = '', footerNote = '', strings = {}, locale = 'en-CA' }) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  const logoUrl = `${origin}/images/brand/aegis-lockup-colour.png`;
  const wordmarkUrl = `${origin}/images/brand/aegis-wordmark.png`;
  const body = blocks.filter(Boolean);
  const language = String(locale).split('-')[0];

  const footerLines = [
    footerNote,
    strings.automated,
    strings.copyright
  ].filter(Boolean);

  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(brand)}</title>
</head>
<body lang="${escapeHtml(language)}" style="margin:0;padding:0;background:${PALETTE.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(strings.preview || '')}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PALETTE.bg}">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
    <tr><td style="padding:0 0 18px">
      <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brand)}" width="124" height="19"
           style="display:block;width:124px;height:auto;border:0">
    </td></tr>
    <tr><td style="padding:28px;background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${body.map(blockHtml).join('\n        ')}
      </table>
    </td></tr>
    <tr><td style="padding:20px 4px 0">
      <img src="${escapeHtml(wordmarkUrl)}" alt="" width="78" height="7"
           style="display:block;width:78px;height:auto;border:0;opacity:.5">
      ${footerLines.map((line) =>
        `<p style="margin:10px 0 0;font-family:${SANS};font-size:11px;line-height:1.6;`
        + `color:${PALETTE.subtle}">${escapeHtml(line)}</p>`).join('\n      ')}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    ...body.map(blockText).filter(Boolean),
    '',
    '—',
    ...footerLines
  ].join('\n\n');

  return { html, text };
}

module.exports = { renderEmail, escapeHtml, PALETTE, blockHtml, blockText };
