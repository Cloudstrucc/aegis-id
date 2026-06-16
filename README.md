# Cloudstrucc Aegis ID

Cloudstrucc Aegis ID is a Node.js Express + HBS reference implementation for a dual-track verified identity service:

- **Microsoft-native production path:** Microsoft Entra ID, YubiKey/passkeys, Conditional Access, and Microsoft Entra Verified ID.
- **Aries interoperability lab:** ACA-Py issuer/verifier/mediator, Bifold/Credo-compatible wallet testing, DIDComm, AnonCreds, and optional VON/Indy development ledger work.

The two tracks share a claim vocabulary and policy layer, but they stay operationally separate. The Aries lab is not a production dependency.

## What Is Included

- Anonymous Cloudstrucc-themed landing page.
- Playable cartoon setup walkthrough video on the home page.
- Subscription form backed by local JSON storage for a free-tier pilot.
- Express API endpoints for Verified ID issuance and presentation requests.
- `VID_MODE=mock` for local demos without a Microsoft tenant connection.
- MSAL-backed `VID_MODE=live` adapter boundary for Microsoft Entra Verified ID.
- Redacted audit event storage.
- Subscriber dashboard with setup wizards for Microsoft Verified ID, Keycloak, Okta, and generic OIDC/SAML.
- OIDC + wallet challenge example relying-party app.
- ACA-Py Docker Compose lab and helper scripts.
- Native SwiftUI iOS Aries wallet starter for Cloudstrucc lab invitations.
- Azure App Service Bicep baseline targeting the Free `F1` tier where available.
- Architecture, operator, Azure deployment, Aries lab, and security docs.

## Operator Guide

For a branded Cloudstrucc Inc. walkthrough covering subscription, dashboard wizards, Mac-to-iPhone QR testing, Microsoft Authenticator, YubiKey/passkey usage, Aries lab checks, and Azure pilot deployment, see:

[docs/cloudstrucc-aegis-id-operator-guide.md](docs/cloudstrucc-aegis-id-operator-guide.md)

For the end-to-end lab flow from web registration to Aries invitation acceptance and a wallet challenge, see:

[docs/cloudstrucc-wallet-e2e-runbook.md](docs/cloudstrucc-wallet-e2e-runbook.md)

## When A Wallet Makes Sense

Use a wallet only when the credential needs to become a portable asset, not just a login event. Wallets make the most sense when Cloudstrucc Inc. needs credentials to move between departments, contractors, allies, auditors, partners, facilities, or external systems outside the issuer's direct control.

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

## Repository Layout

```text
.
├── aries-lab/                 # ACA-Py Docker Compose and admin helper scripts
├── data/                      # Local JSON stores, ignored except .gitkeep
├── docs/                      # Operator, architecture, Azure, Aries, and security docs
├── infra/bicep/               # Azure App Service infrastructure baseline
├── ios/                       # Cloudstrucc Aegis Wallet SwiftUI starter
├── public/                    # Styles, scripts, and generated hero image
├── src/
│   ├── adapters/              # Microsoft Verified ID and Aries boundaries
│   ├── config/                # Environment-driven configuration
│   ├── routes/                # Pages, subscriptions, API endpoints
│   └── services/              # Policy, storage, audit, subscriptions, Verified ID client
├── views/                     # HBS layouts, partials, and pages
├── AGENT.md                   # Source implementation guide
└── wireframe-doc.html         # Source visual/reference document
```

## Local Setup

Use Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://localhost:3000
```

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

Use this checklist to exercise the full Cloudstrucc Aegis ID lab from landing page through platform setup, wallet challenge, and protected app access.

1. Start the web app:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id
   npm install
   cp .env.example .env
   npm run dev
   ```

2. Open the landing page and create a subscription:

   ```text
   http://localhost:3000
   ```

   Submit the subscription form. The app redirects to:

   ```text
   /dashboard/<subscription-id>
   ```

3. Run the platform setup wizards from the subscriber dashboard:

   - Microsoft Entra Verified ID
   - Keycloak
   - Okta
   - Generic OIDC / SAML

4. Start the Aries lab when testing wallet flows:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id/aries-lab
   cp .env.example .env
   docker compose up -d acapy-mediator acapy-issuer acapy-verifier

   cd /Users/frederickpearson/repos/aegis-id
   ./aries-lab/scripts/start-holder-standin.sh
   ```

5. Import and accept an issuer invitation in the iOS simulator wallet:

   ```bash
   ./aries-lab/scripts/create-issuer-invitation.sh > /tmp/cloudstrucc-issuer-invite.json
   jq -r .invitation_url /tmp/cloudstrucc-issuer-invite.json
   ```

   In the iOS simulator app, paste or scan the invitation, open **Connections**, open **Cloudstrucc Aries Issuer**, then tap **Accept invitation in lab**.

6. Test the OIDC + wallet challenge relying-party app:

   ```text
   http://localhost:3000/demo/oidc-wallet
   ```

   Complete mock OIDC login, send the wallet challenge, fetch it in the iOS wallet, accept it, and confirm the browser opens the protected app.

## Main Routes

- `/` anonymous landing page and subscription form.
- `/architecture` architecture view and local demo API controls.
- `/demo/oidc-wallet` example OIDC app that requires a wallet challenge before access.
- `/demo/metadata/keycloak/realms/cloudstrucc/.well-known/openid-configuration` local Keycloak-shaped OIDC discovery document.
- `/demo/metadata/okta/oauth2/default/.well-known/openid-configuration` local Okta-shaped OIDC discovery document.
- `/demo/metadata/generic/oidc` local generic OIDC discovery document.
- `/demo/metadata/generic/saml` local generic SAML metadata document.
- `/dashboard/:subscriptionId` subscriber dashboard after subscription.
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

Use this to test the Microsoft-native credential path. Mock mode works locally; live mode requires your Cloudstrucc Inc. Azure tenant and public HTTPS callback URL.

Wizard path:

```text
/dashboard/<subscription-id>/platforms/microsoft-verified-id/setup
```

Example mock values:

| Step | Field | Example |
| --- | --- | --- |
| Tenant | Tenant display name | `Cloudstrucc Inc.` |
| Tenant | Azure tenant ID | `24a46daa-7b87-4566-9eea-281326a1b75c` |
| Tenant | Primary verified domain | `cloudstrucc.com` |
| Tenant | Public HTTPS app URL | `http://localhost:3000` for mock, Azure HTTPS URL for live |
| Verified ID Service | Issuer authority DID | `did:web:cloudstrucc.com` |
| Verified ID Service | DID method | `did:web` |
| App Registration | Application registration name | `cloudstrucc-aegis-id-verified-id` |
| App Registration | Request Service permission | `VerifiableCredential.Create.All` |
| Credential Contract | Credential type | `CloudstruccEmployeeCredential` |
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
VID_CREDENTIAL_TYPE=CloudstruccEmployeeCredential
VID_CALLBACK_API_KEY=<shared-callback-key>
PUBLIC_BASE_URL=https://<your-app>.azurewebsites.net
```

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
| Realm | Realm | `cloudstrucc` |
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
| Realm | Realm | `cloudstrucc` |
| Realm | Protocol | `SAML 2.0` |
| Client | Client ID | `https://aegis-id.cloudstrucc.local/saml` |
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
| Claims | Groups claim filter | `Cloudstrucc-*` |
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
| App Integration | Client ID | `https://aegis-id.cloudstrucc.local/saml/metadata` |
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
| Provider | Provider name | `Cloudstrucc Mock OIDC` |
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
| Provider | Provider name | `Cloudstrucc Mock SAML` |
| Provider | Protocol | `SAML 2.0` |
| Provider | OIDC issuer URL | leave blank |
| Provider | OIDC discovery or SAML metadata URL | `http://localhost:3000/demo/metadata/generic/saml` |
| Relying Party | Client ID / Entity ID | `https://aegis-id.cloudstrucc.local/saml` |
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
VID_CREDENTIAL_TYPE=CloudstruccEmployeeCredential
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

End-to-end wallet lab: [docs/cloudstrucc-wallet-e2e-runbook.md](docs/cloudstrucc-wallet-e2e-runbook.md)

## OIDC + Wallet Challenge Demo

Open:

```text
http://localhost:3000/demo/oidc-wallet
```

The demo flow is:

1. Start OIDC login.
2. Approve the local mock OIDC provider.
3. Send a Cloudstrucc wallet challenge to the latest active Aries issuer connection.
4. Accept the challenge in the iOS simulator wallet.
5. The browser polls the session and opens the protected example app after the wallet acceptance callback.

Before sending the challenge, make sure the Aries lab and holder stand-in are running and that the iOS simulator wallet has accepted a fresh issuer invitation:

```bash
cd /Users/frederickpearson/repos/aegis-id
cd aries-lab
cp .env.example .env
docker compose up -d acapy-mediator acapy-issuer acapy-verifier

cd /Users/frederickpearson/repos/aegis-id
./aries-lab/scripts/start-holder-standin.sh
./aries-lab/scripts/create-issuer-invitation.sh > /tmp/cloudstrucc-issuer-invite.json
jq -r .invitation_url /tmp/cloudstrucc-issuer-invite.json
```

In the iOS simulator wallet, open the accepted issuer connection, tap **Fetch OIDC challenges**, then accept the pending transaction. The wallet calls back to `/api/oidc-wallet/challenges/:sessionId/accept`, and the browser moves to the protected app when the session becomes authenticated.

This is a lab demonstration of step-up authentication. For production, replace the lab callback with ACA-Py webhooks, a signed presentation, or another server-verifiable wallet response tied to the OIDC session.

## Azure Hosting

The first deployment can fit on Azure App Service Free `F1` if you keep it as the public Node.js/HBS app with mock Verified ID mode and file-backed subscription capture.

```bash
az login
az group create --name rg-cloudstrucc-aegis-id --location canadacentral
az deployment group create \
  --resource-group rg-cloudstrucc-aegis-id \
  --template-file infra/bicep/main.bicep \
  --parameters appName="<globally-unique-app-name>"
```

Deploy a zip package:

```bash
npm ci
npm test
zip -r aegis-id.zip . -x "node_modules/*" ".git/*" ".env" "data/*.json" "tmp/*"
az webapp deploy \
  --resource-group rg-cloudstrucc-aegis-id \
  --name "<globally-unique-app-name>" \
  --src-path aegis-id.zip \
  --type zip
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
- Bifold Wallet: https://github.com/openwallet-foundation/bifold-wallet
- VON Network: https://github.com/bcgov/von-network
