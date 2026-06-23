---
title: Android wallet app development
description: Build, install, distribute, and configure the Vanguard Aegis ID Android wallet.
order: 70
---

# Vanguard Aegis ID Wallet for Android

Native Android companion wallet for the Vanguard Cloud Services - Aegis ID lab. It mirrors the iOS wallet design and uses the hosted Aegis ID bridge instead of talking directly to ACA-Py admin APIs.

For the simple QA and partner distribution runbook, see [Android testing and deployment](/developer/docs/wallet-and-passkeys/android-testing-deployment).

## What It Supports

- Imports `aegisid://invite?...` and raw Aries Out-of-Band invitation URLs.
- Imports `openid-vc://` OpenID VC presentation request URLs for local ledger review.
- Accepts issuer invitations through the hosted Aegis ID lab bridge.
- Issues mock credentials for lab testing.
- Sends and accepts wallet challenges.
- Fetches OIDC wallet challenges from the Aegis ID web app.
- Registers and uses wallet passkeys with Android Credential Manager when an org requires passkey-backed approvals.
- Shows local ledger entries for authentication and high-assurance app actions.
- Shows credential organizations, roles, claims, revocation state, and organization branding when available.

Verified ID and YubiKey are web-app assurance methods in this demo. Microsoft Authenticator presents Verified ID credentials, and the browser performs YubiKey/FIDO2 WebAuthn step-up. The Android wallet receives the downstream Aegis wallet challenge, signs the high-value action, and records the ledger event.

OpenID4VP support is intentionally limited to parsing, storing, and ledger-tracking presentation requests at this stage. Full OpenID4VP response support still requires a W3C verifiable credential store, DID/key management, verifiable presentation signing, verifier response submission, and response validation.

## Project

- Package: `ca.vanguardcs.aegisid.wallet`
- Min SDK: 26
- Target SDK: 35
- UI: Kotlin + Jetpack Compose + Material 3
- Hosted bridge: `https://vanguard-aegis-id-65067d.azurewebsites.net`

## Build Locally

```bash
cd android/VanguardAegisWallet
./gradlew assembleDebug
./gradlew bundleDebug
```

Outputs:

- Debug APK: `app/build/outputs/apk/debug/app-debug.apk`
- Debug AAB: `app/build/outputs/bundle/debug/app-debug.aab`

## Install On A Connected Android Device

Enable USB debugging on the phone, connect it, then run:

```bash
cd android/VanguardAegisWallet
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Wallet Passkey Approval Assurance

Wallet passkeys are optional. Use them when an organization requires phishing-resistant proof before approving wallet challenges.

1. Deploy Aegis ID to HTTPS.
2. Sign the Android build you plan to distribute.
3. Find the SHA-256 certificate fingerprint for that build and set it in Aegis ID:

   ```bash
   az webapp config appsettings set \
     --resource-group rg-vanguard-aegis-id \
     --name vanguard-aegis-id-65067d \
     --settings \
       ANDROID_APP_PACKAGE_NAME=ca.vanguardcs.aegisid.wallet \
       ANDROID_SHA256_CERT_FINGERPRINTS="<sha256-fingerprint>"
   ```

4. Redeploy or restart Aegis ID and confirm:

   ```text
   https://vanguard-aegis-id-65067d.azurewebsites.net/.well-known/assetlinks.json
   ```

5. In the Android wallet, open **Settings > Wallet passkey assurance**.
6. Enter the wallet subject email and tap **Register passkey**.
7. When a Ledger item shows **Passkey required**, tap **Verify passkey and accept...** to complete Android Credential Manager and submit the signed wallet approval.

Without a valid Digital Asset Links file for the exact signing certificate, Android may refuse to create or use passkeys for the Aegis ID relying-party domain.

## Recommended Partner Distribution

For one or a few non-technical Android testers, use **Google Play Internal App Sharing** first. It creates a Play-hosted download link and can accept debug APK/AAB builds, which is much faster than preparing a fully signed production release.

High-level flow:

1. Open Google Play Console.
2. Create the app record for `Vanguard Aegis ID Wallet` if it does not already exist.
3. Go to **Setup > Internal app sharing**.
4. Upload `app/build/outputs/bundle/debug/app-debug.aab` or `app/build/outputs/apk/debug/app-debug.apk`.
5. Copy the generated internal app sharing link.
6. Send the link to your Android business partner.
7. Set the web homepage button:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id \
  --name vanguard-aegis-id-65067d \
  --settings ANDROID_TESTING_URL="https://play.google.com/apps/test/your-link"
```

After the App Service restarts, the Android badge on the Aegis ID homepage will become clickable.

## Better Ongoing QA Distribution

Use a **Google Play Internal Testing** or **Closed Testing** track when you have a repeatable QA group:

1. In Android Studio, open this project.
2. Choose **Build > Generate Signed App Bundle / APK**.
3. Select **Android App Bundle**.
4. Create or select a Vanguard upload key.
5. Build a release `.aab`.
6. In Play Console, go to **Testing > Internal testing** or **Closed testing**.
7. Create an email tester list.
8. Upload the signed release `.aab`.
9. Roll out the test release.
10. Copy the opt-in link and set it as `ANDROID_TESTING_URL`.

## Direct APK Download

Avoid direct APK downloads from the public homepage for non-technical partners. Android will require sideload permissions, and users may see security prompts. Keep direct APK install for internal developer devices only.
