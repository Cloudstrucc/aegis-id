# Submitting the wallets to the App Store and Google Play

Both wallets are already built and signed by the release scripts. This covers
the part those scripts do not do: the store listings, the assets, and the
review questions that will be asked about a credential provider.

## Generating the store assets

```bash
npm run store:assets
```

Drives a booted simulator through the wallet, captures each screen, and writes
`artifacts/store-assets/`:

| Folder | What it is |
|---|---|
| `ios-6.7-1284x2778/` | iPhone 14/15/16 Pro Max — the size App Store Connect asks for first |
| `ios-6.5-1242x2688/` | iPhone 11 Pro Max / XS Max — the older required size |
| `play-phone-1080x1920/` | Play phone screenshots, 9:16 |
| `play-graphics/` | Play feature graphic (1024×500) and icon (512×512) |
| `raw/` | Untouched captures at the simulator's native 1320×2868 |

`artifacts/` is not in version control, so these are rebuilt rather than
committed — the screens change and a stale screenshot in a store listing is
worse than none.

The captures are scaled to the target width and trimmed a few rows at the
centre rather than letterboxed, because Apple expects the full frame. The Play
set pads at the sides instead, since Play rejects anything taller than 9:16 and
cropping to that ratio would cut the content out.

---

## App Store

### 1. Build and upload

```bash
scripts/release-ios.sh --env prod
```

Archives, exports and uploads to App Store Connect. `--env` is repeatable, but
only `prod` belongs in a store submission — dev and qa are for TestFlight.

### 2. Screenshots

App Store Connect wants up to 10 per size. Upload from
`artifacts/store-assets/ios-6.7-1284x2778/`; it will offer to reuse them for
other sizes, and `ios-6.5-1242x2688/` is there if it does not.

The five captured screens, in the order that reads best:

1. `01-home.png` — the branded home screen
2. `02-wallet-id.png` — the Wallet ID, which is the thing a holder shares
3. `05-passkeys.png` — passkeys for other services
4. `04-settings.png` — settings, showing what the wallet holds
5. `03-recovery-codes.png` — recovery codes, shown once

App previews (video) are optional and none are generated. The onboarding video
at `public/videos/setup-walkthrough.mp4` is 1280×720 and the wrong shape for a
phone preview, so it cannot be reused.

### 3. What review will ask about

A credential provider extension attracts questions the rest of the app does
not. Answer them in the review notes rather than waiting to be asked:

- **What the extension does.** It stores FIDO2 passkeys for third-party sites
  and answers the system's passkey requests. It is not an ad blocker, keyboard,
  or content filter.
- **Why it needs the App Group and keychain sharing.** The extension is a
  separate process from the app; both need the same passkey records and keys.
- **That it collects nothing.** Keys are generated on device, are
  non-extractable, and never leave it. There is no analytics and no account
  required to use the passkey feature.
- **A demo account.** Review needs one that can reach the credential screens —
  a wallet registered against prod with at least one issued credential.

### 4. Privacy

The wallet holds an email address and a phone number, both supplied by the
holder, and passkey records that never leave the device. On the App Privacy
questionnaire that is **Contact Info → Email Address / Phone Number**, used for
App Functionality, **not** linked to identity for tracking, and **no** tracking.

Passkeys are not a listed data type. They are on-device credentials, not
collected data.

---

## Google Play

### 1. Build

```bash
scripts/release-android.sh --env prod
```

Produces a signed `.aab` in `artifacts/android/`. Nothing is uploaded — Play
publishing is deliberately manual.

`versionCode` is minutes since 2020-01-01, because Play caps it at 2100000000
and the `YYYYMMDDHHMM` stamp iOS uses does not fit. Pass it explicitly when a
build needs a specific one:

```bash
scripts/release-android.sh --env prod -PaegisVersionCode=$(( ($(date +%s) - 1577836800) / 60 ))
```

### 2. Store listing

| Asset | Where |
|---|---|
| Phone screenshots (min 2) | `artifacts/store-assets/play-phone-1080x1920/` |
| Feature graphic 1024×500 | `artifacts/store-assets/play-graphics/` |
| App icon 512×512 | `artifacts/store-assets/play-graphics/` |

### 3. Declarations Play will require

- **Data safety.** Email and phone, collected, not shared, encrypted in
  transit, deletable by the holder. Passkeys are on-device and not collected.
- **Target audience.** Not directed at children.
- **The credential provider.** Play asks about services with sensitive
  permissions. `BIND_CREDENTIAL_PROVIDER_SERVICE` is declared because the app is
  a passkey provider under the Credential Manager API; it is bound by the system
  only, and is API 34+.
- **Financial features.** None. The wallet holds identity credentials, not
  payment instruments — worth stating, because "wallet" invites the question.

---

## Before either submission

Two things in this repo will get a build rejected or shipped broken:

**The passkey provider does not work end to end yet.** Registration reaches
`handed to iOS` and Safari still rejects it — see
[`wallet-passkey-provider.md`](wallet-passkey-provider.md) for what has been
eliminated. Shipping the feature to a store in that state means shipping a
provider that appears in the OS picker and then fails, which is a poor first
impression and an easy review rejection. Ship it once a real device completes a
registration.

**Cross-device sign-in cannot be claimed.** The listing must not say the wallet
signs you in on a computer by scanning a code. That is the hybrid transport, it
belongs to the operating system, and describing it in a store listing would be a
claim the app cannot meet.
