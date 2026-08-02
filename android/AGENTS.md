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

## Known environment issue

The app does not launch on the API 37 emulator images (`am start` reports
`Activity class … does not exist` even though the class is present in the dex
and registered in the activity resolver). **This predates the flavour work** —
the pre-change APK fails identically — so it is not a regression, but it does
block on-device verification, since the only ARM AVDs on the current machine
are API 37 and the API 36 AVD is x86_64. Worth resolving before UI work.

## Rules

- Do not fake security-sensitive flows.
- Be explicit about what is mock, lab, pilot, or production-ready.
- Preserve immutable decision history and organization context.
- Keep branding aligned with the product.
- Do not run tests unless explicitly asked.
