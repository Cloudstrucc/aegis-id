# Vanguard Cloud Services - Aegis ID

Vanguard Cloud Services - Aegis ID is a Node.js Express + HBS reference implementation for governed identity assurance, wallet challenges, and interoperability testing:

- **Production assurance path:** Subscriber workspaces, Passport-backed sign-in, YubiKey/passkeys, Verified ID integrations, OIDC/SAML integrations, wallet challenges, and audit evidence.
- **Aries interoperability lab:** ACA-Py issuer/verifier/mediator, the Vanguard Aegis ID mobile app, DIDComm, AnonCreds, and optional VON/Indy development ledger work.

The production assurance path and the Aries lab share a claim vocabulary and policy layer, but they stay operationally separate. The Aries lab is not a production dependency.

## What Is Included

- Anonymous Vanguard-themed landing page.
- Playable setup walkthrough video on the home page.
- Passport.js local registration and login for subscriber users.
- Email-code, SMS-code, or passkey second-factor verification before organization subscription.
- Authenticated organization subscription backed by local JSON storage for a free-tier pilot.
- Express API endpoints for Verified ID issuance and presentation requests.
- `VID_MODE=mock` for local demos without a Microsoft tenant connection.
- MSAL-backed `VID_MODE=live` adapter boundary for Microsoft Entra Verified ID.
- Redacted audit event storage.
- Subscriber dashboard with setup wizards for Microsoft Verified ID, Keycloak, Okta, and generic OIDC/SAML.
- OIDC + wallet challenge example relying-party app.
- Standalone example app showing Aegis ID OIDC, wallet-signed expense approvals, and PDF e-signature envelopes backed by wallet challenges.
- ACA-Py Docker Compose lab and helper scripts.
- Native SwiftUI iOS Aries wallet starter for Vanguard Cloud Services lab invitations.
- Azure App Service Bicep baseline targeting the Free `F1` tier where available.
- Architecture, operator, Azure deployment, Aries lab, and security docs.
- Central authorization policy registry, route middleware, and deny-by-default RBAC tests.

## Operator Guide

For a branded Vanguard Cloud Services walkthrough covering subscription, dashboard wizards, Mac-to-iPhone QR testing, Microsoft Authenticator, YubiKey/passkey usage, Aries lab checks, and Azure pilot deployment, see:

[docs/vanguard-aegis-id-operator-guide.md](docs/vanguard-aegis-id-operator-guide.md)

For the end-to-end lab flow from web registration to Aries invitation acceptance and a wallet challenge, see:

[docs/vanguard-wallet-e2e-runbook.md](docs/vanguard-wallet-e2e-runbook.md)

For developer and assessor evidence covering route authorization, RBAC policy registration, org privilege enforcement, and deny-by-default tests, see:

[docs/authorization-rbac.md](docs/authorization-rbac.md)

## When A Wallet Makes Sense

Use a wallet only when the credential needs to become a portable asset, not just a login event. Wallets make the most sense when Vanguard Cloud Services needs credentials to move between departments, contractors, allies, auditors, partners, facilities, or external systems outside the issuer's direct control.

If all you need is secure login to applications, a wallet can add complexity without much benefit. In that case, YubiKey/passkeys plus Entra ID, Keycloak, Okta, or another SSO layer is usually the cleaner path. The real value of wallets starts when the credential itself must be issued, held, presented, verified, and trusted across boundaries.

Wallet-friendly use cases include:

- Portable contractor, employee, partner, student, or member ID.
- Digital ID badge for physical access, front-desk validation, visitor workflows, and field checks.
- Cross-department or cross-organization credential presentation where the relying party should not need direct access to the issuer's directory.
- Digital signatures, proof-of-approval, notarized attestations, or signed workflow evidence.
- Identity validation, age/status/eligibility checks, certifications, licenses, training records, and compliance evidence.
- Selective disclosure where the verifier only needs specific claims instead of a full profile.
- Bring-your-own-identity patterns across Keycloak, Okta, OIDC, SAML, partner portals, and future identity providers.
- Wallet-first auth and RBAC flows where a presented credential, claims, issuer trust, revocation state, and policy rules determine access without a traditional app account being the starting point.

YubiKey is still important, but it solves a different problem: phishing-resistant authentication to accounts and admin surfaces. It is not meant to be the portable credential container, ID badge, signature artifact, or cross-organization proof wallet.

## Wallet Passkey Approval Assurance

Aegis ID now supports an optional wallet passkey layer for high-value wallet challenge approvals. This is separate from subscriber sign-in MFA:

- Subscriber sign-in passkeys protect access to the Aegis ID web dashboard.
- Wallet passkeys protect approvals made from the Aegis ID iOS or Android wallet.
- YubiKey/FIDO2 policy controls decide whether wallet approvals are `disabled`, `preferred`, or `required` for an organization.

To enable it for an organization, open the workspace dashboard, choose **Set Up YubiKey**, and set **Wallet approval passkey policy**:

| Policy | Behavior |
| --- | --- |
| `disabled` | Normal wallet challenge approval. No passkey required. |
| `preferred` | Wallets can register/use passkeys, but approvals are not blocked without one. |
| `required` | Aegis ID rejects wallet challenge acceptance unless the mobile wallet completes a passkey assertion first. |

In the mobile wallet, open **Settings > Wallet passkey assurance**, enter the wallet subject email, and tap **Register passkey**. The iOS wallet supports Apple Passwords/platform passkeys and external security-key passkeys such as YubiKey when the Aegis domain association is valid. For demos, the wallet can also locally require a passkey ceremony before every wallet challenge approval; for production evidence, prefer organization policy set to `required` so Aegis rejects acceptance without server-verified passkey evidence.

This is useful for expense approvals, contract approval, admin promotion, revocation, and other events where the organization wants a stronger, signed proof of user presence at the exact decision moment.

## Repository Layout

```text
.
├── aries-lab/                 # ACA-Py Docker Compose and admin helper scripts
├── data/                      # Local JSON stores, ignored except .gitkeep
├── docs/                      # Operator, architecture, Azure, Aries, and security docs
├── examples/business-expenses # Standalone OIDC + wallet-signature business app
├── infra/bicep/               # Azure App Service infrastructure baseline
├── ios/                       # Vanguard Aegis ID Wallet SwiftUI starter
├── public/                    # Styles, scripts, and generated hero image
├── src/
│   ├── adapters/              # Microsoft Verified ID and Aries boundaries
│   ├── config/                # Environment-driven configuration
│   ├── middleware/            # Session/auth route guards
│   ├── routes/                # Pages, subscriptions, API endpoints
│   └── services/              # Policy, storage, audit, auth, subscriptions, Verified ID client
├── views/                     # HBS layouts, partials, and pages
├── AGENT.md                   # Source implementation guide
└── wireframe-doc.html         # Source visual/reference document
```

## Local Setup

Use Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

The app loads `.env.local` by default for local runs. Use `APP_ENV=prod`, `APP_ENV=dev`, or `APP_ENV=qa` only when intentionally running with another env file.

Run checks:

```bash
npm test
npm run smoke
```

Regenerate the home-page setup walkthrough video:

```bash
npm run video:setup
```

## Full Local Test Process

Use this checklist to exercise the full Vanguard Cloud Services - Aegis ID lab from landing page through platform setup, wallet challenge, and protected app access.

1. Start the web app:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id
   npm install
   cp .env.example .env
   npm run dev
   ```

2. Open the landing page and create an Aegis ID account:

   ```text
   http://localhost:3000
   ```

   Register with a work email and password, then complete the second-factor step. In local development, email/SMS codes are displayed on the verification page so you can test without a mail or SMS provider.

   If that email already has a credential invitation from an organization, Aegis ID sends the user directly to the Organizations page and shows the orgs where they are a credential holder. They can still subscribe their own organization later from the account page.

3. Subscribe an organization after MFA when the user is creating an admin workspace:

   ```text
   /subscribe
   ```

   The verified user becomes the first organization administrator. The app redirects to:

   ```text
   /organizations/<subscription-id>
   ```

4. Register or choose an organization tile, then run the platform setup wizards from the dashboard:

   - Microsoft Entra Verified ID
   - Keycloak
   - Okta
   - Generic OIDC / SAML

5. Start the Aries lab when testing wallet flows:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id/aries-lab
   cp .env.example .env
   docker compose up -d acapy-mediator acapy-issuer acapy-verifier

   cd /Users/frederickpearson/repos/aegis-id
   ./aries-lab/scripts/start-holder-standin.sh
   ```

6. Create and accept an org-scoped issuer invitation:

   - Open `/dashboard/<subscription-id>`.
   - In **Issuing organization**, select **Create Org Issuer Invitation**.
   - Scan the generated Vanguard Aegis ID Wallet QR, or copy the deep link into the simulator.
   - In the iOS simulator wallet, open **Connections**, open the org issuer connection, then tap **Accept invitation in lab**.

   The invitation page also includes portal registration and sign-in links for the invited email. After the invited person creates or signs in to an Aegis ID account with that same email, the Organizations page shows the org as a credential-holder workspace. After wallet acceptance, the credential becomes active and that org is available as a challenge sender in the OIDC wallet demo.

7. Test the OIDC + wallet challenge relying-party app:

   ```text
   http://localhost:3000/demo/oidc-wallet
   ```

   Complete mock OIDC login, send the wallet challenge, fetch it in the iOS wallet, accept it, and confirm the browser opens the protected app.

8. Test the standalone example app:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id/examples/business-expenses
   cp .env.example .env
   npm install
   npm run dev
   ```

   Set `AEGIS_ORGANIZATION_ID` in `.env` to the org workspace whose issuer invitation was accepted by the iOS wallet. Open `http://localhost:4300`, sign in with Aegis ID, fetch and accept the wallet challenge in the iOS wallet, then:

   - Open **Expense Approvals** and approve or reject an expense.
   - Open **E-Signatures**, upload a PDF, place a signature field, save the template, select **Use**, and send the wallet signature challenge.

   The resulting wallet evidence appears in the example app ledger, the Aegis ID organization dashboard, and the iOS/Android wallet Ledger tab.

## Main Routes

- `/` anonymous landing page and account creation form.
- `/auth/register` Passport.js local registration.
- `/auth/login` Passport.js local login.
- `/auth/verify` email/SMS/passkey second-factor verification.
- `/account` authenticated account home for subscribed organizations and credential-holder memberships.
- `/subscribe` authenticated organization subscription for users creating an admin workspace.
- `/organizations/:subscriptionId` authenticated organization selector for admin, contributor, or credential-holder access.
- `/architecture` authenticated architecture view and local demo API controls.
- `/demo/oidc-wallet` authenticated example OIDC app that requires a wallet challenge before access.
- `/demo/metadata/keycloak/realms/vanguard/.well-known/openid-configuration` local Keycloak-shaped OIDC discovery document.
- `/demo/metadata/okta/oauth2/default/.well-known/openid-configuration` local Okta-shaped OIDC discovery document.
- `/demo/metadata/generic/oidc` local generic OIDC discovery document.
- `/demo/metadata/generic/saml` local generic SAML metadata document.
- `/wallet/credential-invitations/:credentialId` credential invite landing page with wallet QR plus portal registration/sign-in links.
- `/dashboard/:subscriptionId` authenticated workspace dashboard after organization subscription or credential-holder membership.
- `/dashboard/:subscriptionId/platforms/:platformId/setup` interactive platform setup wizard.
- `/api/health` service health.
- `/api/issuer/create-offer` creates a mock or live issuance request.
- `/api/verifier/create-request` creates a mock or live presentation request.
- `/api/aries/status` checks local ACA-Py admin endpoints.

## Environment Modes

### Mock mode

Mock mode is the default.

```env
VID_MODE=mock
PUBLIC_BASE_URL=http://localhost:3000
```

Mock mode returns local wallet handoff URLs under `/lab/mock-wallet/...` and lets the UI/API work before Entra Verified ID is configured.

## Subscriber Wizard

After subscribing, the app redirects to the subscriber dashboard. The dashboard tracks connected platforms and setup progress for:

- Microsoft Entra Verified ID / Azure
- Keycloak
- Okta
- Generic OIDC / SAML

The Microsoft wizard lets a subscriber configure tenant details, their DID organization, app registration values, credential type, and claims. The test step can run in mock mode or create a live Microsoft Entra Verified ID issuance/presentation request using a one-time client secret that is not persisted.

More detail: [docs/subscriber-onboarding.md](docs/subscriber-onboarding.md)

## Platform Test Examples

The examples below are intended to make every supported platform card testable from a local developer machine. The federation examples use local mock metadata endpoints; replace those URLs with real provider metadata when moving from lab testing to tenant testing.

### Microsoft Entra Verified ID

Use this to test the Verified ID credential integration. Mock mode works locally; live mode requires your Vanguard Cloud Services Azure tenant and public HTTPS callback URL.

Wizard path:

```text
/dashboard/<subscription-id>/platforms/microsoft-verified-id/setup
```

Example mock values:

| Step | Field | Example |
| --- | --- | --- |
| Tenant | Tenant display name | `Vanguard Cloud Services` |
| Tenant | Azure tenant ID | `24a46daa-7b87-4566-9eea-281326a1b75c` |
| Tenant | Primary verified domain | `vanguardcs.ca` |
| Tenant | Public HTTPS app URL | `http://localhost:3000` for mock, Azure HTTPS URL for live |
| Verified ID Service | Issuer authority DID | `did:web:vanguardcs.ca` |
| Verified ID Service | DID method | `did:web` |
| App Registration | Application registration name | `vanguard-aegis-id-verified-id` |
| App Registration | Request Service permission | `VerifiableCredential.Create.All` |
| Credential Contract | Credential type | `VanguardEmployeeCredential` |
| Credential Contract | Attestation type | `ID token hint` |
| Claims | Required claims | `employeeId, displayName, email, department, role, assuranceLevel, employmentStatus` |
| Claims | Presentation authorization rules | `employmentStatus=active` and `assuranceLevel=FIDO2_YUBIKEY` |
| Test | Test mode | `Mock request` |

Expected mock result: the wizard reports **Mock Verified ID request created** and returns local issuance and presentation request details. The Architecture page can also create the same mock requests with **Create Issuance Offer** and **Create Presentation Request**.

For live mode, set these values in `.env` or in the wizard test step:

```env
VID_MODE=live
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<app-client-id>
AZURE_CLIENT_SECRET=<client-secret-or-use-one-time-field>
VID_AUTHORITY_DID=<issuer-did>
VID_MANIFEST_URL=<credential-manifest-url>
VID_CREDENTIAL_TYPE=VanguardEmployeeCredential
VID_CALLBACK_API_KEY=<shared-callback-key>
PUBLIC_BASE_URL=https://<your-app>.azurewebsites.net
```

For the hosted Vanguard Azure pilot, configure App Service settings after deployment:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id \
  --name vanguard-aegis-id-65067d \
  --settings \
    VID_MODE=live \
    AZURE_TENANT_ID=24a46daa-7b87-4566-9eea-281326a1b75c \
    AZURE_CLIENT_ID=5b80fc58-e2a6-4380-baa2-ad9ac0314334 \
    AZURE_CLIENT_SECRET="<client-secret-from-entra-app-registration>" \
    VID_AUTHORITY_DID="did:web:verifiedid.entra.microsoft.com:24a46daa-7b87-4566-9eea-281326a1b75c:00b93f5f-6831-41de-4e9b-4b8563fba950" \
    VID_MANIFEST_URL="https://verifiedid.did.msidentity.com/v1.0/tenants/24a46daa-7b87-4566-9eea-281326a1b75c/verifiableCredentials/contracts/787e316d-1f93-ef68-b802-0d362ca2137a/manifest" \
    VID_CREDENTIAL_TYPE=VerifiedEmployee \
    VID_CALLBACK_API_KEY="<strong-shared-callback-key>" \
    PUBLIC_BASE_URL=https://vanguard-aegis-id-65067d.azurewebsites.net \
    APP_PUBLIC_BASE_URL=https://vanguard-aegis-id-65067d.azurewebsites.net \
    BUSINESS_EXPENSES_APP_URL=https://vanguard-business-expenses-65067d.azurewebsites.net \
    PASSKEY_RP_ID=vanguard-aegis-id-65067d.azurewebsites.net \
    PASSKEY_ORIGIN=https://vanguard-aegis-id-65067d.azurewebsites.net \
    IOS_APP_TEAM_ID=GL46AP73ZQ \
    IOS_APP_BUNDLE_ID=ca.vanguardcs.aegisid.wallet \
    IOS_APP_BUNDLE_IDS=ca.vanguardcs.aegisid.wallet,ca.vanguardcs.aegisid.wallet.dev,ca.vanguardcs.aegisid.wallet.qa \
    ANDROID_APP_PACKAGE_NAME=ca.vanguardcs.aegisid.wallet \
    ANDROID_SHA256_CERT_FINGERPRINTS="<android-upload-or-app-signing-sha256>"
```

Do not commit real `AZURE_CLIENT_SECRET` or `VID_CALLBACK_API_KEY` values. Set them directly in Azure App Service settings or move them to Key Vault before production use.

| Variable | Purpose |
| --- | --- |
| `VID_MODE` | Switches the Verified ID adapter from local mock responses to live Microsoft Entra Verified ID requests. |
| `AZURE_TENANT_ID` | The Microsoft Entra tenant that owns the Verified ID authority and app registration. |
| `AZURE_CLIENT_ID` | The app registration client ID used for MSAL client-credential tokens. |
| `AZURE_CLIENT_SECRET` | The app registration secret used to request Microsoft Verified ID Request Service tokens. |
| `VID_AUTHORITY_DID` | The issuer authority DID copied from the Entra Verified ID credential contract. |
| `VID_MANIFEST_URL` | The credential manifest URL for the credential contract being issued and presented. |
| `VID_CREDENTIAL_TYPE` | The exact credential type name in the Verified ID contract, for example `VerifiedEmployee`. |
| `VID_CALLBACK_API_KEY` | Shared secret used to protect callbacks from the Verified ID Request Service. |
| `PUBLIC_BASE_URL` / `APP_PUBLIC_BASE_URL` | Public HTTPS base URL used for callbacks, QR payloads, and deep links. |
| `IOS_TESTFLIGHT_PUBLIC_URL` | Optional TestFlight public invitation link shown on the anonymous home page iOS download badge. Use environment-specific links for dev/QA if you publish separate TestFlight apps. |
| `ANDROID_TESTING_URL` | Optional Google Play internal sharing, internal testing, or closed testing link shown on the Android download badge. |
| `BUSINESS_EXPENSES_APP_URL` | URL shown on the signed-in home page for the standalone example app with Expense Approval and E-Signature workflows. |
| `PASSKEY_RP_ID` | WebAuthn relying-party ID. In Azure, use the host only, for example `vanguard-aegis-id-65067d.azurewebsites.net`. |
| `PASSKEY_ORIGIN` | WebAuthn origin. In Azure, use the full HTTPS origin, for example `https://vanguard-aegis-id-65067d.azurewebsites.net`. |
| `WALLET_PASSKEY_STORE_PATH` | File-backed pilot store for mobile wallet passkey credential metadata. Use `/home/data/...` on Azure when you want persistence across deploys. |
| `IOS_APP_TEAM_ID` / `IOS_APP_BUNDLE_ID` / `IOS_APP_BUNDLE_IDS` | Published in `/.well-known/apple-app-site-association` for iOS passkey and app-link association. Use `IOS_APP_BUNDLE_IDS` as a comma-separated list when one Aegis domain should trust prod/dev/QA wallet builds. |
| `ANDROID_APP_PACKAGE_NAME` / `ANDROID_SHA256_CERT_FINGERPRINTS` | Published in `/.well-known/assetlinks.json` for Android passkey and app-link association. |

### Keycloak OIDC

Use this to test a Keycloak-style OIDC metadata integration. No Keycloak server is required for the local metadata test.

Wizard path:

```text
/dashboard/<subscription-id>/platforms/keycloak/setup
```

Example values:

| Step | Field | Example |
| --- | --- | --- |
| Realm | Keycloak base URL | `http://localhost:3000/demo/metadata/keycloak` |
| Realm | Realm | `vanguard` |
| Realm | Protocol | `OpenID Connect` |
| Client | Client ID | `aegis-id-keycloak` |
| Client | Client secret reference | `KEYCLOAK_CLIENT_SECRET` |
| Client | Redirect URI | `http://localhost:3000/auth/keycloak/callback` |
| Client | Metadata or discovery URL | leave blank; Aegis ID derives it from base URL and realm |
| Claims | Claim mappings | `email -> email`, `preferred_username -> username`, `groups -> groups`, `realm_access.roles -> roles` |
| Claims | Required claims | `email, username, groups` |
| Test | Test mode | `Metadata discovery` |

Expected result: **OIDC discovery valid**. For a real Keycloak realm, replace the base URL with your Keycloak host and keep the realm name aligned with the Keycloak realm.

### Keycloak SAML

Use this to test the same Keycloak card with a SAML metadata endpoint.

Example values:

| Step | Field | Example |
| --- | --- | --- |
| Realm | Keycloak base URL | `http://localhost:3000/demo/metadata/keycloak` |
| Realm | Realm | `vanguard` |
| Realm | Protocol | `SAML 2.0` |
| Client | Client ID | `https://aegis-id.vanguard.local/saml` |
| Client | Client secret reference | `KEYCLOAK_SAML_SIGNING_CERT` |
| Client | Redirect URI | `http://localhost:3000/auth/keycloak/callback` |
| Client | Metadata or discovery URL | `http://localhost:3000/demo/metadata/generic/saml` |
| Claims | Claim mappings | `email -> email`, `groups -> groups`, `Role -> roles` |
| Test | Test mode | `Metadata discovery` |

Expected result: **SAML metadata found**.

### Okta OIDC

Use this to test an Okta-style OIDC authorization server.

Wizard path:

```text
/dashboard/<subscription-id>/platforms/okta/setup
```

Example values:

| Step | Field | Example |
| --- | --- | --- |
| Org | Okta org URL | `http://localhost:3000/demo/metadata/okta` |
| Org | Authorization server issuer URL | `http://localhost:3000/demo/metadata/okta/oauth2/default` |
| Org | Protocol | `OpenID Connect` |
| App Integration | Client ID | `aegis-id-okta` |
| App Integration | Client secret reference | `OKTA_CLIENT_SECRET` |
| App Integration | Redirect URI | `http://localhost:3000/auth/okta/callback` |
| App Integration | SAML metadata URL | leave blank for OIDC |
| Claims | Claim mappings | `email -> email`, `groups -> groups`, `department -> department` |
| Claims | Groups claim filter | `Vanguard-*` |
| Test | Test mode | `Metadata discovery` |

Expected result: **OIDC discovery valid**.

### Okta SAML

Use this to test Okta with SAML metadata instead of OIDC discovery.

Example values:

| Step | Field | Example |
| --- | --- | --- |
| Org | Okta org URL | `https://example.okta.com` |
| Org | Authorization server issuer URL | `https://example.okta.com/oauth2/default` |
| Org | Protocol | `SAML 2.0` |
| App Integration | Client ID | `https://aegis-id.vanguard.local/saml/metadata` |
| App Integration | Client secret reference | `OKTA_SAML_CERT_REFERENCE` |
| App Integration | Redirect URI | `http://localhost:3000/auth/okta/callback` |
| App Integration | SAML metadata URL | `http://localhost:3000/demo/metadata/generic/saml` |
| Claims | Claim mappings | `email -> email`, `groups -> groups`, `department -> department` |
| Test | Test mode | `Metadata discovery` |

Expected result: **SAML metadata found**.

### Generic OIDC

Use this for Auth0, Ping, OneLogin, an internal OIDC provider, or any standards-based OIDC issuer.

Wizard path:

```text
/dashboard/<subscription-id>/platforms/generic-oidc-saml/setup
```

Example values:

| Step | Field | Example |
| --- | --- | --- |
| Provider | Provider name | `Vanguard Cloud Services Mock OIDC` |
| Provider | Protocol | `OpenID Connect` |
| Provider | OIDC issuer URL | `http://localhost:3000/demo/metadata/generic` |
| Provider | OIDC discovery or SAML metadata URL | `http://localhost:3000/demo/metadata/generic/oidc` |
| Relying Party | Client ID / Entity ID | `aegis-id-generic-oidc` |
| Relying Party | Secret or certificate reference | `GENERIC_OIDC_CLIENT_SECRET` |
| Relying Party | Callback / ACS URL | `http://localhost:3000/auth/federation/callback` |
| Claims | Claim mappings | `email -> email`, `name -> displayName`, `groups -> groups` |
| Claims | Required claims | `email, displayName` |
| Test | Test mode | `Metadata discovery` |

Expected result: **OIDC discovery valid**.

### Generic SAML

Use this for a standards-based SAML identity provider.

Example values:

| Step | Field | Example |
| --- | --- | --- |
| Provider | Provider name | `Vanguard Cloud Services Mock SAML` |
| Provider | Protocol | `SAML 2.0` |
| Provider | OIDC issuer URL | leave blank |
| Provider | OIDC discovery or SAML metadata URL | `http://localhost:3000/demo/metadata/generic/saml` |
| Relying Party | Client ID / Entity ID | `https://aegis-id.vanguard.local/saml` |
| Relying Party | Secret or certificate reference | `GENERIC_SAML_CERT_REFERENCE` |
| Relying Party | Callback / ACS URL | `http://localhost:3000/auth/federation/callback` |
| Claims | Claim mappings | `email -> email`, `NameID -> subject`, `groups -> groups` |
| Claims | Required claims | `email, subject` |
| Test | Test mode | `Metadata discovery` |

Expected result: **SAML metadata found**.

### Live Microsoft Verified ID mode

After the tenant, app registration, API permissions, issuer DID, and manifest are ready:

```env
VID_MODE=live
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
VID_AUTHORITY_DID=
VID_MANIFEST_URL=
VID_CREDENTIAL_TYPE=VanguardEmployeeCredential
VID_CALLBACK_API_KEY=
PUBLIC_BASE_URL=https://your-app.azurewebsites.net
```

The live adapter uses MSAL client credentials and calls:

- `createIssuanceRequest`
- `createPresentationRequest`

## Aries Lab

```bash
cd aries-lab
cp .env.example .env
docker compose up -d acapy-mediator acapy-issuer acapy-verifier
```

Then from the repo root:

```bash
curl http://localhost:3000/api/aries/status
aries-lab/scripts/create-issuer-invitation.sh
aries-lab/scripts/create-verifier-invitation.sh
```

More detail: [docs/aries-lab.md](docs/aries-lab.md)

End-to-end wallet lab: [docs/vanguard-wallet-e2e-runbook.md](docs/vanguard-wallet-e2e-runbook.md)

## OIDC + Wallet Challenge Demo

Open:

```text
http://localhost:3000/demo/oidc-wallet
```

The demo flow is:

1. Start OIDC login.
2. Approve the local mock OIDC provider.
3. Choose the issuing org that should send the wallet challenge.
4. Accept the challenge in the iOS simulator wallet.
5. The browser polls the session and opens the protected example app after the wallet acceptance callback.

Before sending the challenge, make sure the Aries lab and holder stand-in are running and that the iOS simulator wallet has accepted an org issuer invitation from the subscriber dashboard:

```bash
cd /Users/frederickpearson/repos/aegis-id
cd aries-lab
cp .env.example .env
docker compose up -d acapy-mediator acapy-issuer acapy-verifier

cd /Users/frederickpearson/repos/aegis-id
./aries-lab/scripts/start-holder-standin.sh
```

Then open `/dashboard/<subscription-id>`, create the org issuer invitation, and accept it in the iOS simulator wallet.

In the OIDC challenge page, select the issuing org from the dropdown and send the challenge. In the iOS simulator wallet, open the accepted org issuer connection, tap **Fetch OIDC challenges**, then accept the pending transaction. The wallet calls back to `/api/oidc-wallet/challenges/:sessionId/accept`, and the browser moves to the protected app when the session becomes authenticated.

This is a lab demonstration of step-up authentication. For production, replace the lab callback with ACA-Py webhooks, a signed presentation, or another server-verifiable wallet response tied to the OIDC session.

## Azure Hosting

The deploy scripts now load environment files directly:

| Env | File | Intended target |
| --- | --- | --- |
| `local` | `.env.local` | Localhost only |
| `dev` | `.env.dev` | Future dev Azure deployment |
| `qa` | `.env.qa` | Future QA Azure deployment |
| `prod` | `.env` | Production Azure deployment |

Fill in secrets such as `SESSION_SECRET`, `AZURE_CLIENT_SECRET`, and `VID_CALLBACK_API_KEY` yourself. Blank secret values are not pushed over existing Azure App Service settings by the deploy script.

To deploy the same codebase into another Azure tenant, seed a tenant profile and pass it to the provision/deploy scripts:

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/configure-tenant-profile.sh --tenant vanguardcs

bash scripts/provision-azure-lab-env.sh --env prod --tenant vanguardcs
bash scripts/deploy-azure-webapp.sh --env prod --tenant vanguardcs
```

The `--tenant` value can be the profile alias or the Azure tenant ID. The seeded `vanguardcs` profile targets tenant `6b4b0578-e6a2-4693-8f4c-af55cb10de87` and subscription `93471fe7-92b9-43a5-85b3-72b0ee0e75d1`. Fill the tenant-prefixed secrets in `.env`, `.env.dev`, `.env.qa`, and the matching Business Expenses env files before deployment.

Production refresh deploy:

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/deploy-azure-webapp.sh --env prod
```

Production standalone example app deploy:

```bash
bash scripts/deploy-azure-business-expenses.sh --env prod
```

The example app exposes two demo workflows from its landing page:

- **Expense Approvals:** approve/reject rows with Aegis wallet challenge evidence.
- **E-Signatures:** upload a PDF, place a signature field, send a wallet challenge, and stamp the signed envelope with signer, timestamp, and signature ID.

The script also verifies:

- `/api/health`
- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`
- MediaPipe runtime assets used by the ID verification pilot

Future dev/QA refresh deploys:

```bash
bash scripts/deploy-azure-webapp.sh --env dev
bash scripts/deploy-azure-webapp.sh --env qa
bash scripts/deploy-azure-business-expenses.sh --env dev
bash scripts/deploy-azure-business-expenses.sh --env qa
```

Future tenant-profile refresh deploys:

```bash
bash scripts/deploy-azure-webapp.sh --env dev --tenant vanguardcs
bash scripts/deploy-azure-webapp.sh --env qa --tenant vanguardcs
bash scripts/deploy-azure-business-expenses.sh --env dev --tenant vanguardcs
bash scripts/deploy-azure-business-expenses.sh --env qa --tenant vanguardcs
```

More detail: [docs/azure-deployment.md](docs/azure-deployment.md)

## Cost Notes

Free-tier realistic:

- Public landing page.
- Subscription capture.
- Mock Verified ID request demos.
- Local Aries lab on your workstation.
- Default `azurewebsites.net` HTTPS host.

Likely not free or not production-ready on Free tier:

- Key Vault-backed production setup.
- App Insights / Log Analytics retention.
- Custom domain and production TLS requirements.
- Durable production storage.
- Deployment slots, Always On, scale-out, private networking, or production SLA expectations.
- Verified ID usage beyond free allowances or tenant-specific licensing constraints.

## References

- Azure App Service Node.js quickstart: https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs
- Azure App Service plans: https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans
- Microsoft Entra Verified ID Request Service REST API: https://learn.microsoft.com/en-us/entra/verified-id/get-started-request-api
- Microsoft Entra Verified ID advanced setup: https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-tenant
- ACA-Py documentation: https://aca-py.org/latest/
- VON Network: https://github.com/bcgov/von-network
