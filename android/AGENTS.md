# Aegis ID Android Guidance

Use this guidance for work under `/android`.

## Priorities

- keep wallet challenge flows explicit and trustworthy
- preserve approval and decline behavior
- keep passkey, WebAuthn, and YubiKey flows understandable
- preserve parity with the web platform where expected

## Build flavours

One flavour per environment, mirroring the iOS build configurations, so all
four can be installed side by side:

| Flavour | applicationId | URL scheme | Web app |
|---|---|---|---|
| `local` | `…wallet.local` | `aegisid-local` | `http://10.0.2.2:3000` |
| `dev` | `…wallet.dev` | `aegisid-dev` | dev host |
| `qa` | `…wallet.qa` | `aegisid-qa` | qa host |
| `prod` | `…wallet` | `aegisid` | prod host |

```bash
./gradlew :app:assembleDevDebug
```

The base URL, URL scheme and App Links host all come from `aegisEnvironment(...)`
in `app/build.gradle.kts`, so a new environment cannot be added with one and not
the others. `app_name` is a per-flavour `resValue`, so do not define it in
`strings.xml` as well — that is a duplicate resource error.

**`10.0.2.2` is how an emulator reaches the host machine**; `localhost` is the
emulator itself. Cleartext HTTP is permitted for the `local` flavour only, via
`app/src/local/` — hosted flavours keep Android's default refusal.

**`versionCode` is capped at 2100000000**, so the `YYYYMMDDHHMM` stamp iOS uses
for `CFBundleVersion` does not fit. Pass `-PaegisVersionCode=` minutes since
2020-01-01 instead; the build fails with an explanation if it is out of range.

## Emulators

`Aegis_API35_arm64` is set up for local work. The app also runs correctly on the
API 37.1 images — an earlier report that it did not was **a corrupted AVD
package database**, not the image and not the app.

The symptom is worth recognising because it is very misleading: `am start`
reports `Activity class … does not exist` for a newly installed app even though
the class is present in the dex and `dumpsys package` lists its intent filters.
The tell is that `cmd package query-activities -a android.intent.action.MAIN -c
android.intent.category.LAUNCHER` returns only a handful of activities — 4 on
the broken AVD versus 19 after a wipe. Fix it by wiping that AVD:

```bash
emulator -avd <name> -wipe-data
```

Do not chase this in the app. Native libraries were 16KB-aligned, the class was
in the dex, and the same APK launched fine on a fresh AVD.

If an AVD needs creating, note that the `tools/bin` sdkmanager and avdmanager
bundled here are too old: sdkmanager needs Java 8
(`JAVA_HOME=$(/usr/libexec/java_home -v 1.8)`) because JAXB was removed after
that, and avdmanager cannot parse the current package metadata at all. Install
the image with sdkmanager under Java 8, then write the AVD by hand — it is only
two files:

```
~/.android/avd/<name>.ini            path, path.rel, target=android-35
~/.android/avd/<name>.avd/config.ini abi.type=arm64-v8a, hw.cpu.arch=arm64,
                                     image.sysdir.1=system-images/android-35/google_apis/arm64-v8a/,
                                     tag.id=google_apis
```

x86_64 images cannot run on Apple Silicon, which rules out the API 36 AVD.

## Wallet identity

Registration, recovery, contact changes and organization acceptance live in
`WalletStoreIdentity.kt` as extensions on `WalletStore`, talking to the product
API through `WalletRegistrationClient` — never through ACA-Py, so they work on
deployments with no Aries lab. The setup gate in `WalletApp` blocks the tabs
until a Wallet ID exists, because a credential cannot bind without one.

Identity and the device key live in `EncryptedSharedPreferences`. Recovery
**rotates** the device key rather than restoring it, which is why nothing
sensitive needs backing up.

**Any code that matches a URL scheme must not hardcode `aegisid`** — each
flavour registers its own (`aegisid-dev`, `aegisid-qa`, `aegisid-local`), so a
literal match silently drops every deep link outside the prod build. This
applies to `MainActivity.handleIntent` and `OrganizationInviteParser`, both of
which had that bug.

## Releases

```bash
scripts/release-android.sh --env dev
scripts/release-android.sh --env all --apk
```

`--env` mirrors `scripts/release-ios.sh` and the Azure deploy scripts, is
repeatable, and accepts bare names. `all` means dev, qa and prod — never
`local`, which points at a development server on the host machine.

Signing comes from an untracked `.env.android` at the repo root (template:
`.env.android.example`); exported values win, and `--env-file` overrides the
location. **One keystore covers every environment**, unlike iOS's per-team API
key, because the flavours differ only by applicationId suffix. Credentials are
checked before any build, so a missing keystore costs a second rather than a
full Gradle run.

Without credentials a release build stays **unsigned** rather than falling back
to the debug key, which would produce something that looks releasable and is
not. `--debug` builds unsigned deliberately and needs no credentials.

The script does not upload. Artifacts land in `artifacts/android/` and
publishing to Play is a manual step.

## Rules

- Do not fake security-sensitive flows.
- Be explicit about what is mock, lab, pilot, or production-ready.
- Preserve immutable decision history and organization context.
- Keep branding aligned with the product.
- Do not run tests unless explicitly asked.
