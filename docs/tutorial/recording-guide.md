# Setup walkthrough — recording guide

A shot-by-shot plan and voiceover script for a screen-recorded tutorial of the
full setup, suitable for YouTube.

Target length **9–10 minutes**. Every route below is real; every value in
`{braces}` comes from the recording card the seed script prints.

**Voice.** The narration is written in a neutral product register — no "I", no
"we", and the viewer is not addressed as "you". That is deliberate: it lets
anyone record it, survives being re-recorded by a different person or a
synthesised voice, and does not date when the person who made it moves on. Keep
that register if you edit the script. Everything outside the `>` blocks is a
stage direction and addresses the person recording directly.

---

## Two ways to get the footage

**Record the browser legs automatically**, then film only the phone:

```bash
npm install --no-save playwright && npx playwright install chromium
npm run demo:seed -- --reset
npm run video:walkthrough
```

That drives the real application through every browser step — filling the
forms, clicking through, with a visible cursor — and writes
`artifacts/walkthrough/`:

| File | What it is |
|---|---|
| `walkthrough.mp4` | 1280×720, about 4½ minutes, chaptered |
| `chapters.txt` | paste straight into the YouTube description |
| `shots.json` | every step and gap with its timestamp |

The wallet steps are a phone, which a browser cannot drive, so they become
titled gaps of a known length — 90 seconds for wallet setup, 35 for each scan.
Film those separately and drop them into the gaps; the chapter markers still
line up. `shots.json` tells the editor exactly where.

**Or record it by hand** with the shot list below, which is the same journey
with the narration written out. Do that if you want the pacing of a person
rather than a script, or if you are demonstrating something the automation does
not cover.

Either way the voiceover script below is what gets narrated, and the seeded
environment is the same.

---

## Before you record

### 1. Seed the environment

```bash
npm run demo:seed
```

Then start the app **through the same script**, so it reads the demo stores
rather than your own:

```bash
npm run demo:run
```

The demo lives in `data/demo/` and never touches `data/`, so your development
accounts and workspaces survive. Plain `npm start` will not see any of the
seeded data — that is the intended separation, not a bug.

Keep the recording card it prints open in a second window. You will need the
three nominee Wallet IDs and the registration code on camera.

The seed deliberately leaves the tutorial's own steps undone — your account,
your organization, the third root wallet, and the credential you issue are all
created live. What it fills in is everything *around* them, so no screen shows
zeroes.

Re-running is refused unless you pass `--reset`, because seeding twice stacks a
second organization onto the first.

### 2. Decide how the phone reaches the server

This is the one decision that will cost you a re-shoot if you get it wrong.

| Option | Wallet | Server | Trade-off |
|---|---|---|---|
| **A — simulator** (recommended) | iOS Simulator, Local scheme | `http://localhost:3000` | Works immediately. You cannot film a real phone scanning the screen. |
| **B — real phone** | Local build pointed at your LAN IP | `PUBLIC_BASE_URL=http://192.168.x.x:3000` | Authentic QR scan. Needs a custom wallet build and both devices on the same network. |

Option A for most of the recording; option B only if you want the physical scan
shot in step 5. You can mix them — record the scan separately and cut it in.

**Whichever you choose, the wallet build has to register the scheme this
environment emits.** Local emits `aegisid-local://`. The prod build registers
`aegisid` and will not open those links at all on iOS, where a scheme is
claimed exclusively.

```bash
# Option B: bind to the LAN address so a phone can reach it
PUBLIC_BASE_URL=http://192.168.1.50:3000 node scripts/seed-demo-environment.js --run
```

For option B you must also change `AEGIS_WEB_APP_BASE_URL` in the iOS
`Debug-Local` configuration (or the Android `local` flavour) to the same
address, or the wallet will call `localhost` and reach itself.

### 3. Browser setup

- New profile or a clean window — no bookmarks bar, no other tabs, no extensions.
- 1440×900. Larger looks impressive live and illegible at 1080p.
- Zoom to 110–125%. Form labels are small at native scale.
- Dismiss the "Administrator profile validation due in 30 days" banner on the
  seeded org before recording, unless you intend to talk about it.

### 4. Record audio separately

Script first, record the voiceover as one take, then match footage to it. Doing
it the other way round means re-recording narration to fit clips, which is the
slowest way to make a tutorial.

---

## Shot list

Timings are targets, not constraints. `→` marks a click, `⌨` marks typing.

### 00:00 — Cold open: what this is (45s)

**Screen:** `/` home page, scrolled to the architecture diagram (`#architecture`).

> Most organizations answer "who is this?" in a dozen places at once. Every
> application keeps its own copy of who may do what, every integration adds
> another way in, and when someone loses their laptop, recovering their access
> means a support ticket.
>
> Aegis ID holds that policy in one place. Identity can be proven several ways —
> a passkey, a hardware key, an approval from a phone — and consumed by any
> number of applications. What stays constant is the middle: a single decision
> point that makes the call and records what it decided.
>
> This walkthrough sets one up from nothing: a plan, an account, an
> organization, a wallet, the wallets that can recover the whole thing, and a
> credential issued to a real device.

**Shots:** slow scroll through the three architecture columns. Pause on
"Aegis ID decides".

---

### 00:45 — Step 1: Choose a plan (45s)

**Route:** `/plans`

> The plan comes first, and that ordering is deliberate. An organization that
> needs Enterprise finds that out on the pricing page rather than after filling
> in a registration form.

→ `Choose a plan` from the home header
→ compare the tiers, hover Basic
→ `Choose Basic`

> This walkthrough uses Basic, redeemed with a registration code — the way a
> plan is handed to a pilot customer or an internal team without a card being
> involved at all.

**Note:** the checkout page appears only when `STRIPE_SECRET_KEY` is set. If it
is not, narrate "card checkout is off on this deployment until a payment
provider is configured" and take the code path — that is accurate, and it is
what a fresh install does.

---

### 01:30 — Step 2: Create the account (60s)

**Route:** `/auth/register`

⌨ Name: `Frederick Pearson`
⌨ Work email: `fpearson@vanguardcs.ca`
⌨ Password
⌨ Registration code: `{code from the recording card}`

> The work email matters: organization invitations are matched against it
> later.
>
> The registration code is checked here, before the account is created. An
> invalid one returns to this form rather than leaving behind a half-made
> account that cannot have the plan it asked for.

→ `Create account` → lands on `/auth/verify`

**Cut to:** terminal showing `data/demo/mail/` and `tail` the newest file.

> Sign-in codes are never returned in a response. Every message goes through
> the delivery service — which on a developer machine writes to a folder, and on
> a hosted environment sends over email or SMS once an administrator has
> configured it. Until that is configured, delivery fails closed rather than
> quietly doing nothing.

⌨ the six-digit code → signed in

---

### 02:30 — Step 3: Create the organization (60s)

**Route:** `/subscribe` → redirects to `/organizations/{sub}`

⌨ Organization: `Vanguard Cloud Services`
→ `Create organization`

> An organization's name is a label, not an identity. Two subscribers can both
> be called Cloudstrucc, and they always will be able to — real companies share
> names.

**Route:** `/organizations/{sub}/{ws}/domain`

> Identity lives in two other things: a handle, assigned once and never reused,
> which gives the organization a public page anyone can check; and optionally a
> verified domain.

→ claim `vanguardcs.ca` → show the TXT record

> Verification is by DNS rather than file upload, because publishing a record
> in the zone requires control of the zone. A file only proves control of one
> web server.

**Cut to:** `/orgs/{handle}` in a second tab

> Unverified is not anonymous. Every organization has this page, and it states
> plainly whether the domain has been proven.

---

### 03:30 — Step 4: Set up the wallet (90s)

**Screen:** phone or simulator.

> There are two wallets, iOS and Android, and they behave identically on first
> run.

→ open the wallet → register with `fpearson@vanguardcs.ca`

> Setup mints a Wallet ID and shows ten recovery codes exactly once.

**Shot:** hold on the recovery codes screen for a beat.

> The device key behind it never leaves the phone. Recovery *rotates* that key
> rather than restoring it, which is why nothing sensitive needs backing up
> anywhere — and why these ten codes are the only copy of the way back in.

→ `I have saved my codes` → wallet home showing the Wallet ID

> A Wallet ID is an identifier, not a secret. It is meant to be shared — which
> is exactly why the next step works the way it does.

---

### 05:00 — Step 5: The first root wallet (90s)

**Route:** `/organizations/{sub}/{ws}/root-wallets`

> Root wallets are the wallets that can recover administrative control of an
> organization. They exist because control otherwise rests on an email address
> and on the platform operator — meaning Vanguard could restore access to a
> customer's organization, and so could anyone who took over their inbox.

⌨ paste the Wallet ID from the phone → `Nominate`

**Shot:** the row appears as **Pending**.

> The row says pending. Nominating is not confirming. A Wallet ID is public, so
> if nominating alone were enough, anyone who saw one could make that wallet
> responsible for an organization.

→ `Show QR`

**Cut to:** phone scanning the QR (option B) or opening the deep link (option A).

**Shot:** wallet shows "Confirm root wallet — VCS nominated this wallet".
→ `Confirm`

**Cut back to:** browser, refresh, row now says **Confirmed**.

> The token that authorised that travelled only in the QR code. It is
> single-use, it expires in seventy-two hours, and it is discarded the moment it
> is spent.

---

### 06:30 — Step 6: Get to three (60s)

**Route:** same page.

⌨ paste `{Dana Reyes Wallet ID}` → `Nominate`
⌨ paste `{Sam Okonkwo Wallet ID}` → `Nominate`

> These are registered wallets belonging to two other people. Each is nominated
> the same way, and each holder confirms from their own device.

**Shot:** the meter moving to 3 of 3, then the callout that appears.

> One root wallet is enough to operate. It also means one lost device strands
> the organization. Three, held by different people, means no single loss does.
>
> At three, something changes. An administrator who loses their authenticator is
> recovered by two of these wallets approving from their own devices, with no
> platform administrator involved at any point. The weaker
> recovery-code-and-email path closes for that organization — because a route
> that is easier to attack is not an alternative, it is the way in.

**Optional cut:** `/auth/recover/approvals` to show the flow exists.

> Each approval link goes to its own wallet holder's registered address, never
> to the person recovering. Anyone who has taken over the administrator's inbox
> reaches a status page and nothing they can act on.

---

### 07:30 — Step 7: Issue a credential (75s)

**Route:** `/dashboard/{sub}/orgs/{ws}` → People, then Credentials

> With root wallets confirmed, the organization can issue credentials. Before
> that it could not: issuance is blocked for an organization with no way back.

→ `Credentials` blade → `Invite credential`
⌨ holder email, job title
⌨ Wallet ID: the phone's

> Binding the invitation to a Wallet ID is the high-assurance option — only that
> wallet can accept it. Without one, the invitation binds to the holder's
> registered email or phone instead, which is weaker.

→ `Create issuance` → QR appears

**Cut to:** phone scanning → credential detail → `Accept credential`

**Cut back to:** the credentials list, status now **Active**.

---

### 09:00 — Step 8: The evidence, and close (60s)

**Route:** `/dashboard/{sub}/orgs/{ws}` — the Ledger blade

> Every one of those steps is on the evidence chain — the nomination, the
> confirmation, the issuance, the acceptance. Hash-chained and append-only, so
> the record of what happened cannot be quietly edited afterwards.
>
> That is the full setup: a plan, an account, an organization that can prove who
> it is, three wallets that can recover it without the platform operator, and a
> credential bound to a real device.
>
> Links to the written guide and the documentation are in the description.

**Shot:** end on the dashboard with real numbers in the tiles.

---

## Post-production

1. **Captions** — Descript generates them from your audio and exports SRT.
   Upload the SRT to YouTube rather than relying on auto-captions; "Wallet ID"
   and "AnonCreds" do not survive automatic transcription.
2. **Zoom** — zoom into the form when typing and into the table when a status
   changes. Those are the two places a viewer needs to see detail.
3. **Cut the waiting.** Page loads, QR generation, and wallet polling are all
   dead air. Cut them; nobody needs to watch a spinner.
4. **Chapters** — put the timestamps in the description as `0:00 Intro` etc.
   YouTube turns them into chapter markers, and this video is long enough to
   need them.

## Things that will bite you

- **A stale wallet registration.** If you re-run the seed with `--reset`, every
  Wallet ID changes. Re-read the recording card.
- **Starting the app the usual way.** `npm start` reads `data/`, not
  `data/demo/`, so none of the seeded organization will be there. Use
  `npm run demo:run`.
- **Recording without reseeding.** `npm run video:walkthrough` creates an
  account and an organization in the demo stores. Running it twice without
  `demo:seed -- --reset` in between fails on the duplicate email — which is the
  product being right, and still a wasted run.
- **Wrong environment on the phone.** A wallet pointed at dev will not find a
  wallet registered on local, and the error says exactly that — but only if you
  read it. Registrations are per environment.
- **The `.env.local` scheme.** `WALLET_URL_SCHEME` overrides the per-environment
  default. If you have set it, the QR will not match the wallet build.
- **Issuance blocked mid-take.** If you record step 7 before step 5 has actually
  confirmed a root wallet, issuance is refused. That is the product working
  correctly and it will still ruin the take.
