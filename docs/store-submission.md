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
| `ios-ipad-13-2064x2752/` | iPad Pro 13-inch — required, see below |
| `play-phone-1080x1920/` | Play phone screenshots, 9:16 |
| `play-graphics/` | Play feature graphic (1024×500) and icon (512×512) |
| `raw/` | Untouched iPhone captures at the simulator's native 1320×2868 |
| `raw-ipad/` | Untouched iPad captures, already 2064×2752 |

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

The captured screens, in the order that reads best:

1. `01-home.png` — the branded home screen
2. `02-wallet-id.png` — the Wallet ID, which is the thing a holder shares
3. `06-getting-started.png` — the Getting started guide
4. `04-settings.png` — settings, showing what the wallet holds
5. `03-recovery-codes.png` — recovery codes, shown once

`05-passkeys.png` is **not** in the 1.0 set. That screen is hidden in this build
— see below — so a screenshot of it would advertise something the binary does
not do.

#### The iPad set

**App Store Connect will not accept a submission without it**, because the
project declares `TARGETED_DEVICE_FAMILY = "1,2"`. Upload
`ios-ipad-13-2064x2752/` into the 13-inch iPad slot.

Capture these on an **iPad Pro 13-inch** simulator, not by padding the iPhone
ones — a 13-inch capture is natively 2064×2752, so nothing is resampled, and the
two aspect ratios are far enough apart that padding is obvious.

```bash
xcrun simctl boot "iPad Pro 13-inch (M4)"
xcodebuild -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet Local" -configuration Debug-Local \
  -sdk iphonesimulator -destination 'name=iPad Pro 13-inch (M4)' build
```

`-configuration Debug-Local` matters. The scheme's own configuration is not
`Debug`, and building `Debug` gives a wallet pointed at **production** — which
registers a real wallet on prod rather than against a local server.

Three screens are in the current set: Home, the Wallet ID, and the recovery
codes. Settings and the Getting started guide were captured and dropped, because
a local build prints `localhost` where the service name goes and that has no
place in a listing. Capture those two against a hosted environment if a longer
iPad set is wanted.

**The layout is a phone layout on a 13-inch display.** It is not broken, but the
setup screens leave a wide empty band. Worth deciding whether iPad support earns
its place at all — dropping to `TARGETED_DEVICE_FAMILY = "1"` removes both the
screenshot requirement and the chance of a reviewer finding a stretched screen.

App previews (video) are optional and none are generated. The onboarding video
at `public/videos/setup-walkthrough.mp4` is 1280×720 and the wrong shape for a
phone preview, so it cannot be reused.

### 3. What review will ask about

**1.0 does not ship the credential provider**, so the questions an AutoFill
extension attracts do not arise. The app declares no
`autofill-credential-provider` entitlement and embeds no `.appex`; nothing
appears under Settings › General › AutoFill & Passwords. Do not describe the
feature in the review notes — it is not in the binary being reviewed.

What review does still need:

- **A way to see the app work.** The wallet is useless without an organization
  issuing to it, so the review notes carry a long-lived credential invitation
  the reviewer pastes on the Home tab. See
  [`store-listing-copy.md`](store-listing-copy.md).
- **Why there is no sign-in.** There is no username or password; first run
  registers the device against an address the holder chooses.

When the provider does ship, in 1.1 or later, these come back:

- **What the extension does.** It stores FIDO2 passkeys for third-party sites
  and answers the system's passkey requests. It is not an ad blocker, keyboard,
  or content filter.
- **Why it needs the App Group and keychain sharing.** The extension is a
  separate process from the app; both need the same passkey records and keys.
- **That it collects nothing.** Keys are generated on device, are
  non-extractable, and never leave it. There is no analytics and no account
  required to use the passkey feature.

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

**The passkey provider does not work end to end yet, and iOS 1.0 therefore
leaves it out.** Registration reaches `handed to iOS` and Safari still rejects
it — see [`wallet-passkey-provider.md`](wallet-passkey-provider.md) for what has
been eliminated.

Shipping it anyway would mean shipping a provider that iOS advertises in its own
settings on our behalf and that then fails every time. A missing feature costs
nothing; a broken advertised one costs the listing its credibility, and the
one-star reviews outlive the fix.

So on iOS the extension is built but not embedded, the app's autofill
entitlement is gone, and the Passkeys screen is hidden behind
`AegisWalletEnvironment.providesPasskeysForOtherServices`. Nothing was deleted —
flipping that flag back and restoring two `project.pbxproj` entries ships it,
once a real device completes a registration.

**Android still ships its provider.** The failure documented above is iOS-only,
and the Android path was never observed failing. If it has not been exercised on
a device either, hold it back the same way rather than assuming.

**Cross-device sign-in cannot be claimed.** The listing must not say the wallet
signs you in on a computer by scanning a code. That is the hybrid transport, it
belongs to the operating system, and describing it in a store listing would be a
claim the app cannot meet.
