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

**Use an API 35 ARM64 AVD.** The app does not launch on the API 37.1 images:
`am start` reports `Activity class … does not exist` even though the class is
in the dex and registered in the activity resolver. That is the image, not the
app — a pre-flavour APK fails there identically and the same APK launches fine
on API 35.

`Aegis_API35_arm64` is set up for this. If it needs recreating, note that the
`tools/bin` sdkmanager and avdmanager bundled here are too old: sdkmanager
needs Java 8 (`JAVA_HOME=$(/usr/libexec/java_home -v 1.8)`) because JAXB was
removed after that, and avdmanager cannot parse the current package metadata at
all. Install the image with sdkmanager under Java 8, then write the AVD by
hand — it is only two files:

```
~/.android/avd/<name>.ini            path, path.rel, target=android-35
~/.android/avd/<name>.avd/config.ini abi.type=arm64-v8a, hw.cpu.arch=arm64,
                                     image.sysdir.1=system-images/android-35/google_apis/arm64-v8a/,
                                     tag.id=google_apis
```

x86_64 images cannot run on Apple Silicon, which rules out the API 36 AVD.

## Rules

- Do not fake security-sensitive flows.
- Be explicit about what is mock, lab, pilot, or production-ready.
- Preserve immutable decision history and organization context.
- Keep branding aligned with the product.
- Do not run tests unless explicitly asked.
