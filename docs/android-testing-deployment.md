# Vanguard Aegis ID Android Testing and Deployment

Simple steps for testing and sharing the Android wallet with QA or a business partner.

## 1. Open the Android Project

```bash
cd /Users/frederickpearson/repos/aegis-id/android/VanguardAegisWallet
```

Optional: open the folder in Android Studio.

## 2. Build a Debug APK

```bash
./gradlew assembleDebug
```

The APK will be created here:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## 3. Test on an Android Emulator

1. Open Android Studio.
2. Open **Device Manager**.
3. Start an emulator.
4. Install the APK:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

5. Open **Vanguard Aegis ID Wallet** on the emulator.
6. Paste or open an `aegisid://invite?...` link from the Aegis ID web dashboard.
7. Tap **Accept invitation**.
8. Check **Organizations** and **Ledger** tabs for the accepted org and wallet transactions.

## 4. Test on a Physical Android Phone

1. On the phone, enable **Developer options**.
2. Enable **USB debugging**.
3. Connect the phone by USB.
4. Confirm the debugging prompt on the phone.
5. Install the APK:

```bash
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

6. Open the app on the phone.
7. From the Aegis ID web app, create an org issuer invitation or credential invite.
8. Scan the QR code with the phone camera, or copy/paste the invite link into the wallet.

## 5. Share with a Non-Technical Tester

Recommended for early testing: **Google Play Internal App Sharing**.

1. Create or open the app in Google Play Console.
2. Go to **Setup > Internal app sharing**.
3. Upload:

```text
app/build/outputs/apk/debug/app-debug.apk
```

or build and upload the debug bundle:

```bash
./gradlew bundleDebug
```

```text
app/build/outputs/bundle/debug/app-debug.aab
```

4. Copy the generated Play internal sharing link.
5. Send that link to the tester.
6. Set the Android homepage download link in Azure:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id \
  --name vanguard-aegis-id-65067d \
  --settings ANDROID_TESTING_URL="PASTE_INTERNAL_SHARING_LINK_HERE"
```

7. Restart the Aegis ID web app if Azure does not apply the setting automatically.

For dev or QA web apps, set the same variable on the matching environment instead:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id-dev \
  --name vanguard-aegis-id-dev-65067d \
  --settings ANDROID_TESTING_URL="PASTE_DEV_TESTING_LINK_HERE"

az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id-qa \
  --name vanguard-aegis-id-qa-65067d \
  --settings ANDROID_TESTING_URL="PASTE_QA_TESTING_LINK_HERE"
```

The web deploy script also reads `ANDROID_TESTING_URL` from `.env`, `.env.dev`, or `.env.qa`. Keep the env value blank if you prefer managing the testing link only in Azure App Service settings.

## 6. Build a signed release

Use the release script rather than Android Studio's dialog. It signs from an
untracked `.env.android`, stamps a shared version code across every flavour in
one run, and writes to `artifacts/android/`.

```bash
scripts/release-android.sh --env prod              # bundle only
scripts/release-android.sh --env prod --apk        # bundle and APK
scripts/release-android.sh --env dev --env qa      # repeatable
```

Two things worth knowing:

- **Play takes the `.aab`.** New apps have required an App Bundle since 2021.
  The `.apk` is only for the sideload page at `/downloads/android`.
- **`--apk` is not cosmetic.** Without it Gradle never runs `assemble`, so the
  APK is only built when asked for. The script refuses to copy an artifact
  older than the build that supposedly produced it, which is what stops a
  weeks-old APK being handed back under today's filename.

`versionCode` is minutes since 2020-01-01 — monotonic, and it fits inside
Play's 2,100,000,000 ceiling where a `YYYYMMDDHHMM` stamp does not. Override it
with `-PaegisVersionCode=`. `versionName` defaults to `1.0` and is kept in step
with `MARKETING_VERSION` in the iOS project.

Signing comes from `.env.android` (template `.env.android.example`); one
keystore covers every environment. With no credentials, release builds stay
unsigned rather than silently falling back to the debug key — an artifact that
looks releasable and is not.

## 7. Use a Proper QA Track

1. Build the bundle as above.
2. In Google Play Console, go to **Testing > Internal testing**.
3. Add tester email addresses.
4. Upload the signed `.aab`.
5. Roll out the test release.
6. Copy the opt-in link.
7. Set `ANDROID_TESTING_URL` in Azure to that opt-in link.

## 8. What QA Should Test

1. Install the wallet.
2. Open the Aegis ID web app.
3. Create or open an organization workspace.
4. Create an issuer invitation QR.
5. Scan or paste the invitation in the Android wallet.
6. Accept the invitation.
7. Send a wallet challenge from the web app.
8. Accept the challenge in the Android wallet.
9. Confirm the Ledger tab shows the challenge history.
10. Confirm the Organizations tab shows roles, claims, and revocation state.
11. Optional passkey test: open wallet **Settings > Wallet passkey assurance**, register a passkey, set the org **YubiKey > Wallet approval passkey policy** to **Required**, and approve a Business Expenses decision. The Ledger action should require passkey verification before acceptance.

This is the wallet's *own* passkey assurance, which works. It is not the same
feature as the wallet acting as a passkey provider for other sites — that is
disabled in 1.0, so Aegis ID does not appear under **Settings > Passwords,
passkeys and data services** and there is nothing to test there. See
[`wallet-passkey-provider.md`](wallet-passkey-provider.md).

## Notes

- The wallet is a shipping application at version 1.0. The Aries protocols apply
  only to lab connections; credentials and challenges go through the Aegis ID
  service directly.
- Use Google Play testing links for business partners. Avoid public APK download links for non-technical users because sideloading causes security prompts.
- For production release, use a signed release app bundle, privacy policy, app content declarations, and closed testing before public Play Store release.
