# App Store and Play listing copy

Ready to paste. Character counts are against Apple's limits and were checked,
not estimated.

Everything here describes what the wallet actually does today. Nothing claims
cross-device passkey sign-in, and **iOS 1.0 does not ship the passkey provider
at all** — the block at the end stays out of the listing and out of the review
notes until a device completes a registration. See
[`store-submission.md`](store-submission.md).

---

## Promotional Text — 148 / 170

> Hold the credentials your organization issues you, approve sign-ins and
> requests from your phone, and keep a clear record of every decision you make.

Promotional text can be changed without submitting a new build, so this is the
field to update when something is worth announcing.

---

## Description — 1,893 / 4,000

```
Vanguard Aegis ID Wallet holds the credentials your organization issues to you,
and lets you approve or decline the requests those organizations send — from
your own device, with your own biometric.

WHAT IT IS FOR

Your employer, your client, or an organization you contract to issues you a
credential. It arrives in this wallet. From then on, when a connected
application needs to be sure it is really you — signing in, approving an
expense, signing a document — the request comes to your phone. You see who is
asking and what they are asking for, and you decide.

Declining is a real answer, and both answers are recorded.

YOUR WALLET ID

Setting up takes a minute and gives you a Wallet ID: a short identifier you
share with an administrator so they can issue credentials to this device. It is
an identifier, not a secret — knowing it does not let anyone act as you.

RECOVERY THAT DOES NOT DEPEND ON ANYONE ELSE

The key behind your wallet is generated on this device and never leaves it. It
is not in any backup, which is why recovery rotates that key rather than
restoring it, and why you are given ten single-use recovery codes during setup.
Keep them somewhere safe — they are shown once.

An organization can also nominate your wallet as a root wallet. Root wallet
holders can restore administrative control of that organization between
themselves, without the platform operator being involved at any point.

EVIDENCE YOU CAN READ

Every acceptance, approval and decline is written to an append-only,
hash-chained ledger. The Ledger tab shows your own history: what was asked,
when, and what you answered. Nothing there can be quietly edited afterwards.

WHAT YOU NEED

This wallet is a companion to the Vanguard Aegis ID platform. An organization
using Aegis ID has to issue you a credential or send you an invitation — the
wallet is not useful on its own.
```

---

## Keywords — 93 / 100

```
credential,identity,workforce,employee,badge,approval,authenticator,verifiable,enterprise,sso
```

No spaces after the commas — they count against the limit. "Wallet", "Aegis",
"Vanguard" and "ID" are deliberately absent: Apple already indexes the app name,
and repeating those wastes characters.

---

## Support URL

```
https://vanguard-aegis-id-0e75d1.azurewebsites.net/support
```

Public and unauthenticated — the people who most need it are the ones who cannot
sign in, and a store listing cannot point at a page behind a login.

**Set `SUPPORT_EMAIL` on prod before submitting.** With it unset the page says
plainly that no address is configured, which is honest but is not a support
page. Review does check this URL.

```bash
az webapp config appsettings set --name vanguard-aegis-id-65067d --resource-group <rg> --settings SUPPORT_EMAIL=contact-aegis-id@vanguardcs.ca
```

`scripts/deploy-azure-webapp.sh` forwards the setting, so a later deployment
keeps it.

## Marketing URL

```
https://vanguard-aegis-id-0e75d1.azurewebsites.net/
```

## Privacy Policy URL

Required by both stores.

```
https://vanguard-aegis-id-0e75d1.azurewebsites.net/privacy
```

Public and unauthenticated, like the support page. `PRIVACY_POLICY_URL` defaults
to this page — set the variable only to point at a different policy, such as a
corporate one covering more than this service.

**It has not been through legal review.** It describes what the code actually
does, which is the hard part, but the retention periods, the governing law and
the controller's legal name are business decisions rather than technical ones.
Have somebody qualified read it before submitting.

---

## Version

`1.0`, matching the field. **The project said `0.1.1` until this was written** —
`MARKETING_VERSION` is now `1.0` across every configuration. They have to agree
or the build will not attach to the App Store version.

## Copyright — needs your legal entity

Apple's format is the year and the legal name, with no © symbol:

```
2026 Cloudstrucc Inc.
```

Use whatever entity holds the Apple Developer account. If that is Vanguard
Cloud Services rather than Cloudstrucc, use that instead — a mismatch here gets
queried.

---

## App Review Information

### Sign-In Information

**Leave "Sign-in required" unchecked.** The wallet has no username and password —
first run registers the device against an email address the holder chooses and
mints a Wallet ID. Ticking the box and supplying nothing is worse than leaving
it clear.

The real risk is different: a reviewer who registers and finds an empty wallet
sees an app that appears to do nothing, which is a rejection under app
completeness. The Notes below carry a pasteable invitation so the reviewer
reaches a populated wallet in about a minute. **That invitation has to be
generated before submitting** — see below.

### Notes — paste this, with the two placeholders filled in

```
WHAT THIS APP IS

Vanguard Aegis ID Wallet is the holder-side companion to Vanguard Aegis ID, an
enterprise identity service. An organization issues a credential to a person, it
arrives in this wallet, and the person then approves or declines the requests
that follow - signing in, approving an expense, signing a document - from their
own device.

The wallet is not useful on its own, so a demo organization has been
pre-provisioned for you below.

NO ACCOUNT OR PASSWORD IS NEEDED

There is no username or password. On first run the wallet registers itself
against an email address you choose and mints a Wallet ID, which is the
identifier a holder shares with an administrator. Any address works, nothing is
verified against a directory, and no mail is sent to you.

HOW TO SEE THE FULL FUNCTIONALITY

Each invitation below is addressed to one email address and can be redeemed
once, so we have prepared several. Use the first pair; if the app says that
address is already registered, move to the next pair.

1. Launch the app and tap "Get started".
2. Enter the email address from a pair below and tap "Create my wallet".
3. You are shown a Wallet ID, then ten recovery codes. Turn on "I have saved
   these codes" and tap "Finish setup".
4. On the Home tab, tap "Import invitation" and paste the link from the same
   pair. Tap "Import".
5. The wallet joins the "Vanguard CS" organization and the credential appears
   under the Orgs tab. Open it to see "Raise a test challenge", which creates an approval
   you can accept or decline on the Ledger tab.

   Pair 1 - appreview1@example.com
   <INVITATION LINK 1>

   Pair 2 - appreview2@example.com
   <INVITATION LINK 2>

   Pair 3 - appreview3@example.com
   <INVITATION LINK 3>

   Pair 4 - appreview4@example.com
   <INVITATION LINK 4>

Every invitation is valid until <DATE>. No mail is sent to any of these
addresses and none of them needs to exist.

PRIVACY

The app collects an email address and, optionally, a phone number, both entered
by the holder, and uses them only so an organization can address a credential to
the right person. There is no analytics and no tracking. Credentials and passkey
material stay on the device.

We are happy to give a live walkthrough on request.
```

### Generating the invitation links

**Why five, and why each has its own address.** A credential invitation is
bound to the email it was issued to — `assertBinding` resolves the wallet by
that address and refuses any other. And an address registers exactly once. So a
single address in the Notes works for exactly one review attempt: the first
reviewer registers it, and every attempt after that — a second reviewer, a
resubmission, the same reviewer on a fresh device — is stopped at "A wallet is
already registered with this email" with no way forward. That is the rejection
this app already received once.

An organization invitation would sidestep the email binding, but **accepting one
makes that wallet the organization's first root wallet.** Handing Apple's
reviewer recovery authority over the demo organization is not an acceptable
trade for a smoother review.

So: several credential invitations, each to a fresh address. Do this before
submitting, on **prod**, signed in as an *administrator* of the organization —
a holder credential in an organization (the Contractor role, say) cannot issue,
and the request answers "Organization workspace not found for this subscriber".

The organization also needs a confirmed root wallet first, or
`ROOT_WALLET_POLICY_ENFORCED` blocks issuance. And mind the plan: a Trial
subscription caps credentials, so the fifth invitation was refused with a 402
on the first run — four pairs is what is in the Notes today, issued 2026-09-11
against **Vanguard CS** (`8ab6c114-61ff-4723-9e8c-c7e15e472afd`) and valid to
**2027-09-11**.

1. Sign in and open the organization you want the reviewer to see.
2. Credentials → invite a credential for `appreview1@example.com`.
3. **Set the invitation window to 365 days.** The default is 7, and an
   invitation that expires mid-review is a rejection that costs a full cycle.
4. Copy the `aegisid://credential-invite?…` deep link from the invitation panel
   — not the QR image. A reviewer has one device and cannot scan a code shown on
   the screen they are holding.
5. Repeat for `appreview2@example.com` onward — as many as the plan allows.
6. Paste each link into the Notes under its pair, and put the expiry date in
   place of `<DATE>`.

**After any rejection**, check which pairs were consumed under
`/admin/wallets` and top the Notes back up before resubmitting. Do not
reuse `appreview@example.com` — it is spent.

### Attachment

Optional, and not needed. The invitation link in the Notes does the work a QR
image cannot.

### Contact Information

Yours — a real phone number and an address that is monitored. Review does call
when a submission needs clarifying, and an unanswered contact stalls the whole
thing.

### App Store Version Release

**Manually release this version.**

The scheduled option is pre-filled with a date that means nothing, and automatic
release puts a first version in front of the public the moment it is approved.
Manual lets you confirm the demo invitation still works and the passkey feature
behaves before anyone can download it.

---

## Google Play

Play asks for a short and a full description rather than promotional text.

**Short description — 76 / 80**

```
Hold the credentials your organization issues, and approve requests securely.
```

**Full description** — the App Store description above works unchanged; Play
allows 4,000 characters too.

---

## The passkey block — hold this back for now

Do **not** add this until a device completes a passkey registration end to end.
Advertising a feature that appears in the system picker and then fails is an
easy review rejection and a poor first impression.

```
PASSKEYS FOR OTHER SERVICES

Aegis ID can also hold FIDO2 passkeys for any site or app that supports them,
not only for Aegis. Turn it on under Settings › General › AutoFill & Passwords
and choose Aegis ID when a site asks where to save a passkey. Keys are generated
on this device, are not extractable, and are never backed up or synced.

Passkeys held here work on this device. Signing in on a computer by scanning a
code uses a transport the operating system reserves for itself, so no
third-party app can offer it.
```

That second paragraph is not optional if the first is used. Saying a wallet
holds passkeys without saying they are device-only invites one-star reviews from
people expecting them to appear on their laptop.
