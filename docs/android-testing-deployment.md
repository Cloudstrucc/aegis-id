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

## 6. Use a Proper QA Track

Use this when testing with a stable group of Android users.

1. In Android Studio, choose **Build > Generate Signed App Bundle / APK**.
2. Select **Android App Bundle**.
3. Create or select a Vanguard upload key.
4. Build the release `.aab`.
5. In Google Play Console, go to **Testing > Internal testing**.
6. Add tester email addresses.
7. Upload the signed `.aab`.
8. Roll out the test release.
9. Copy the opt-in link.
10. Set `ANDROID_TESTING_URL` in Azure to that opt-in link.

## 7. What QA Should Test

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

## Notes

- The Android wallet is currently a lab wallet, not a production DIDComm wallet engine.
- Use Google Play testing links for business partners. Avoid public APK download links for non-technical users because sideloading causes security prompts.
- For production release, use a signed release app bundle, privacy policy, app content declarations, and closed testing before public Play Store release.
