# Outbound messages

Every message the platform sends — sign-in codes, reset links, wallet
recovery, root-wallet approvals — goes through `deliverMessage` in
`src/services/otp-delivery-service.js`. This describes what it sends and in
which language.

## Where the words live

```
src/emails/
  index.js                 builds one message: subject, html, text, sms
  render.js                blocks -> HTML and plain text
  catalogue/en-CA.js       English (Canada)
  catalogue/fr-CA.js       Français (Canada)
```

A message is a list of blocks — `heading`, `text`, `code`, `button`, `meta`,
`note`, `warn` — and the renderer turns the same list into both the HTML part
and the plain-text alternative. That is the point of the structure: every
multipart message this platform sent before was text only, and the quickest
way to end up with a stale text part is to maintain it by hand beside a
template.

To add a message type, add it to both catalogues and to `MESSAGE_TYPES` in
`notification-settings-service` — a type missing from the second has no row in
the channel matrix at `/admin/notifications` and cannot be switched off.
`tests/email-templates.test.js` fails if the three lists disagree.

## Which language

`src/services/i18n-service.js`, first supported wins:

1. `user.locale`, if the person has chosen one
2. the `Accept-Language` of the request that triggered the message
3. `en-CA`

The stored preference comes first because it is the only one still true when
a background path sends the message later, with no browser to ask. It is
captured from the browser at registration and changed from the language
control in the profile modal, which posts to `/account/language`.

Matching is on the language, not the full tag: `fr`, `fr-FR` and `fr-ca` all
reach `fr-CA`. An unsupported language falls back to English rather than
failing — not sending a sign-in code is worse than sending it in the wrong
language.

## Conventions these templates keep

- **No code or link in the subject or the preview.** Convenient, and it puts
  a factor on a locked screen for anyone standing nearby. The reader opens the
  message. A test enforces it.
- **The palette is a copy, held in step by a test.** Mail cannot use CSS
  custom properties, so `render.js` carries the token values literally and
  `tests/email-templates.test.js` compares them to `brand-layer.css`.
- **Tables, inline styles, no classes, no `<style>`, no web fonts.** Outlook
  on Windows renders through Word; Gmail strips `<style>` from forwarded mail.
- **The lockup is absolute** and served from the deployment that sent the
  message, so an organization on its own hostname sends its own.
- **The footer names the organization** only when the message really is on
  one's behalf, and never when that name is the brand's own.

## Seeing one locally

`local` uses the `filesystem` transport, so nothing is sent:

- `artifacts/mail/` — one `.txt` per message, with the subject and locale in
  its header. Everything that reads this directory treats it as one file per
  message; do not add a second.
- `artifacts/mail-html/` — the rendered HTML part, openable in a browser.

To preview every message in both languages without sending any:

```bash
node -e "
const {buildMessage,messageTypes}=require('./src/emails');
for (const l of ['en-CA','fr-CA']) for (const t of messageTypes())
  console.log(l, t, '—', buildMessage({type:t,locale:l,variables:{code:'482913'},brand:'Aegis ID'}).subject);
"
```

`dev`, `qa` and `prod` start fail-closed until an admin configures SMTP or SMS
at `/admin/notifications`.
