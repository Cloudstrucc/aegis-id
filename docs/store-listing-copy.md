# App Store and Play listing copy

Ready to paste. Character counts are against Apple's limits and were checked,
not estimated.

Everything here describes what the wallet actually does today. Nothing claims
cross-device passkey sign-in, and the passkey provider is held back to an
optional block at the end — see the note there before using it.

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

**You need to create this.** Apple requires a page where a user can actually get
help, and the deployment has no support or contact page today. The Get Started
Guide is close but offers no way to reach anybody:

```
https://vanguard-aegis-id-0e75d1.azurewebsites.net/docs/tutorial/get-started-guide.html
```

A short page with a support email address is enough, and is the safer answer —
review does check this one.

## Marketing URL

```
https://vanguard-aegis-id-0e75d1.azurewebsites.net/
```

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
