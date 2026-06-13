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
- ACA-Py Docker Compose lab and helper scripts.
- Azure App Service Bicep baseline targeting the Free `F1` tier where available.
- Architecture, operator, Azure deployment, Aries lab, and security docs.

## Operator Guide

For a branded Cloudstrucc Inc. walkthrough covering subscription, dashboard wizards, Mac-to-iPhone QR testing, Microsoft Authenticator, YubiKey/passkey usage, Aries lab checks, and Azure pilot deployment, see:

[docs/cloudstrucc-aegis-id-operator-guide.md](docs/cloudstrucc-aegis-id-operator-guide.md)

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

## Main Routes

- `/` anonymous landing page and subscription form.
- `/architecture` architecture view and local demo API controls.
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
