# Setup walkthrough — recording guide

A shot-by-shot plan and voiceover script for a screen-recorded tutorial of the
full setup, suitable for YouTube.

Target length **9–10 minutes**. Every route below is real; every value in
`{braces}` comes from the recording card the seed script prints.

---

## Before you record

### 1. Seed the environment

```bash
node scripts/seed-demo-environment.js
```

Then start the app **through the same script**, so it reads the demo stores
rather than your own:

```bash
node scripts/seed-demo-environment.js --run
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

> Most systems answer "who is this?" in a dozen places at once. Every app keeps
> its own copy of who may do what, every integration adds another way in, and
> when someone loses their laptop the answer to "how do we get them back?" is
> usually a support ticket and a shrug.
>
> Aegis ID is one place that holds that policy. Identity can be proven in
> several ways — a passkey, a hardware key, an approval from a phone — and
> consumed by any number of applications. What stays constant is the middle:
> one decision point that makes the call, and writes down what it decided.
>
> In the next nine minutes I'm going to set one up from nothing. A plan, an
> account, an organization, a wallet, the wallets that can recover the whole
> thing, and a credential issued to a real device.

**Shots:** slow scroll through the three architecture columns. Pause on
"Aegis ID decides".

---

### 00:45 — Step 1: Choose a plan (45s)

**Route:** `/plans`

> The plan comes first, and that ordering is deliberate. If your organization
> needs Enterprise, you find that out on the pricing page rather than after
> you've filled in a registration form.

→ `Choose a plan` from the home header
→ compare the tiers, hover Basic
→ `Choose Basic`

> I'll take Basic. I have a registration code, which is how you'd hand a plan to
> a pilot customer or an internal team without a card ever being involved.

**Note:** the checkout page appears only when `STRIPE_SECRET_KEY` is set. If it
is not, say "card checkout is off on this deployment" and use the code path —
that is honest and it is what a fresh install does.

---

### 01:30 — Step 2: Create the account (60s)

**Route:** `/auth/register`

⌨ Name: `Frederick Pearson`
⌨ Work email: `fpearson@vanguardcs.ca`
⌨ Password
⌨ Registration code: `{code from the recording card}`

> Use the work email the organization will actually use — organization
> invitations match on it later.
>
> The code is checked here, before the account is created, so an invalid one
> re-renders this form rather than leaving you with a half-made account that
> can't have the plan it asked for.

→ `Create account` → lands on `/auth/verify`

**Cut to:** terminal showing `data/demo/mail/` and `tail` the newest file.

> Sign-in codes are never shown in a response — they go through the delivery
> service. On a laptop that writes them to a folder. On a hosted environment
> an administrator configures email or SMS first, and until they do, delivery
> fails closed rather than quietly doing nothing.

⌨ the six-digit code → signed in

---

### 02:30 — Step 3: Create the organization (60s)

**Route:** `/subscribe` → redirects to `/organizations/{sub}`

⌨ Organization: `Vanguard Cloud Services`
→ `Create organization`

> The name is a label, not an identity. Two subscribers can both be called
> Cloudstrucc, and they always will be able to — real companies share names.

**Route:** `/organizations/{sub}/{ws}/domain`

> Identity lives in two other things. A handle, assigned once and never reused,
> which gives the organization a public page anybody can check. And optionally a
> verified domain.

→ claim `vanguardcs.ca` → show the TXT record

> DNS rather than a file upload, because publishing a record in the zone
> requires control of the zone. A file only proves control of one web server.

**Cut to:** `/orgs/{handle}` in a second tab

> Unverified is not anonymous. Every organization has this page, and it says
> plainly whether the domain is proven.

---

### 03:30 — Step 4: Set up the wallet (90s)

**Screen:** phone or simulator.

> Two wallets, iOS and Android, and they do the same thing on first run.

→ open the wallet → register with `fpearson@vanguardcs.ca`

> It mints a Wallet ID, and shows ten recovery codes exactly once.

**Shot:** hold on the recovery codes screen for a beat.

> The device key that backs this never leaves the phone. Recovery *rotates*
> that key rather than restoring it — which is why there's nothing sensitive
> to back up anywhere, and why these ten codes are the only copy of the way
> back in.

→ `I have saved my codes` → wallet home showing the Wallet ID

> That Wallet ID is an identifier, not a secret. You can share it. Which is
> exactly why the next step works the way it does.

---

### 05:00 — Step 5: The first root wallet (90s)

**Route:** `/organizations/{sub}/{ws}/root-wallets`

> Root wallets are the wallets that can recover administrative control of this
> organization. They exist because otherwise control rests on an email address
> and on us — meaning Vanguard could restore access to your organization, and so
> could anyone who took over your inbox.

⌨ paste the Wallet ID from the phone → `Nominate`

**Shot:** the row appears as **Pending**.

> Notice it says pending. Nominating is not confirming. A Wallet ID is public,
> so if nominating were enough, anyone who saw one could make that wallet
> responsible for an organization.

→ `Show QR`

**Cut to:** phone scanning the QR (option B) or opening the deep link (option A).

**Shot:** wallet shows "Confirm root wallet — VCS nominated this wallet".
→ `Confirm`

**Cut back to:** browser, refresh, row now says **Confirmed**.

> The token that did that travelled only in the QR. It's single-use, it expires
> in seventy-two hours, and it's discarded the moment it's spent.

---

### 06:30 — Step 6: Get to three (60s)

**Route:** same page.

⌨ paste `{Dana Reyes Wallet ID}` → `Nominate`
⌨ paste `{Sam Okonkwo Wallet ID}` → `Nominate`

> These two are already registered wallets belonging to two other people. I'll
> nominate them, and they'd confirm from their own devices the same way.

**Shot:** the meter moving to 3 of 3, then the callout that appears.

> One root wallet lets you operate. It also means one lost device strands the
> organization. Three, held by different people, means no single loss does.
>
> And at three, something changes. An administrator who loses their
> authenticator is now recovered by two of these wallets approving from their
> own devices — with no platform administrator anywhere in it. The weaker
> recovery-code-and-email path closes for this organization, because a route
> that's easier to attack isn't an alternative, it's the way in.

**Optional cut:** `/auth/recover/approvals` to show the flow exists.

> The approval links go to each wallet holder's own address — never to the
> person recovering. Someone who's taken over the administrator's inbox reaches
> a status page and nothing they can act on.

---

### 07:30 — Step 7: Issue a credential (75s)

**Route:** `/dashboard/{sub}/orgs/{ws}` → People, then Credentials

> With root wallets confirmed, the organization can issue. Before that it
> couldn't — issuance is blocked for an organization with no way back.

→ `Credentials` blade → `Invite credential`
⌨ holder email, job title
⌨ Wallet ID: the phone's

> Binding the invitation to a Wallet ID is the high-assurance option: only that
> wallet can accept it. Without one it binds to the holder's registered email or
> phone instead, which is weaker.

→ `Create issuance` → QR appears

**Cut to:** phone scanning → credential detail → `Accept credential`

**Cut back to:** the credentials list, status now **Active**.

---

### 09:00 — Step 8: The evidence, and close (60s)

**Route:** `/dashboard/{sub}/orgs/{ws}` — the Ledger blade

> Every one of those steps is on the evidence chain — the nomination, the
> confirmation, the issuance, the acceptance. Hash-chained and append only, so
> the record of what happened can't be quietly edited afterwards.
>
> That's the whole setup. A plan, an account, an organization that can prove who
> it is, three wallets that can recover it without us, and a credential bound to
> a real device.
>
> Links to the guide and the docs are in the description.

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
  `data/demo/`, so none of the seeded organization will be there. Start it with
  `--run`.
- **Wrong environment on the phone.** A wallet pointed at dev will not find a
  wallet registered on local, and the error says exactly that — but only if you
  read it. Registrations are per environment.
- **The `.env.local` scheme.** `WALLET_URL_SCHEME` overrides the per-environment
  default. If you have set it, the QR will not match the wallet build.
- **Issuance blocked mid-take.** If you record step 7 before step 5 has actually
  confirmed a root wallet, issuance is refused. That is the product working
  correctly and it will still ruin the take.
