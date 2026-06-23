---
title: Business Expenses example app
description: Configure and test the standalone Business Expenses and e-signature example app with Aegis ID.
order: 40
---

# Vanguard Aegis Example Apps

Standalone Node.js/Express app showing how an organization can use Vanguard Aegis ID for:

- OIDC sign-in to a business application.
- Microsoft Entra Verified ID presentation on registration/sign-in.
- YubiKey 5C NFC / FIDO2 browser step-up on registration/sign-in.
- Wallet challenge for high-value approve/reject expense decisions.
- Wallet-backed PDF e-signature envelopes with signer, timestamp, signature ID, and ledger evidence.
- Ledger reporting in the web app, Aegis ID dashboard, and Aegis ID mobile wallet.

## 1. Prerequisites

1. Start Aegis ID from the repo root:

   ```bash
   npm install
   npm run dev
   ```

2. In Aegis ID, create or open an organization dashboard.
3. Create an org issuer invitation from the dashboard.
4. Import and accept that invitation in the iOS simulator wallet or Android wallet.
5. Copy the organization workspace ID and set it as `AEGIS_ORGANIZATION_ID`.
6. Configure live Microsoft Entra Verified ID in Aegis ID and issue a `VerifiedEmployee` credential to Microsoft Authenticator when testing the Verified ID path.

The app can also target a raw issuer connection with `AEGIS_ISSUER_CONNECTION_ID`, but the recommended path is organization-scoped.

## 2. Configure

```bash
cd examples/business-expenses
cp .env.example .env.local
```

Edit `.env.local`:

```bash
AEGIS_ID_BASE_URL=http://localhost:3000
AEGIS_ORGANIZATION_ID=<your-aegis-organization-workspace-id>
APP_PUBLIC_BASE_URL=http://localhost:4300
VERIFIED_ID_AUTH_ENABLED=true
YUBIKEY_AUTH_ENABLED=true
AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED=false
```

Set `AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED=true` when you want every approve/reject decision to require mobile wallet passkey assurance. You can also leave it `false` and enforce the same behavior centrally from the Aegis ID organization dashboard by setting **Set Up YubiKey > Wallet approval passkey policy > Required**.

## 3. Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:4300
```

## 4. Test The Flow

### Verified ID path

1. Click **Register with Verified ID** or **Sign in with Verified ID**.
2. Authorize the OIDC request on the Aegis ID authorization screen.
3. The Business Expenses app creates a Microsoft Verified ID presentation request.
4. In Microsoft Authenticator:
   - Open **Verified IDs**.
   - Scan the presentation QR.
   - Share the `VerifiedEmployee` credential.
5. Return to the example app. The landing page opens the protected workflows.
6. Open **Expense Approvals** and press **Approve** or **Reject** on an expense.
7. In the Vanguard Aegis ID wallet:
   - Open the issuer connection.
   - Tap **Fetch OIDC challenges**.
   - Open the new challenge in **Ledger** or the connection transaction list.
   - Accept the challenge. If the organization requires wallet passkey assurance, register a passkey in wallet **Settings** first, then use **Verify passkey and accept...**.
8. Review the signed action in:
   - Business Expenses `/ledger`
   - Aegis ID organization dashboard, **External app ledger**
   - Aegis ID mobile wallet **Ledger** tab

### YubiKey path

1. Click **Sign in with YubiKey**.
2. Authorize the OIDC request on the Aegis ID authorization screen.
3. Insert or tap a YubiKey 5C NFC / security key when the browser WebAuthn prompt appears.
4. If you do not have a key available during the demo, use **Record pilot fallback**. It is clearly marked as a simulated pilot event.
5. Return to Business Expenses. The expense table opens.
6. Approve or reject an expense, then accept the Aegis wallet challenge in the mobile wallet. If passkey approvals are required, the wallet prompts for the device passkey before the callback is accepted.
7. Open `/ledger` to see both **YubiKey assurance events** and **Aegis ID challenge records**.

### E-signature path

1. Sign in with Verified ID, YubiKey, or the wallet-only lab path.
2. Open **E-Signatures**.
3. Upload a PDF.
4. Click the PDF preview to place the signature field, or drag the field into position.
5. Save the template.
6. In **Configured templates**, press **Use**.
7. Click the signature field or press **Send Signature Challenge**.
8. Open the Vanguard Aegis ID wallet, fetch the challenge, and approve the `sign-document` request. If the organization requires wallet passkey assurance, complete the mobile passkey prompt before acceptance.
9. Return to the envelope page. The PDF signature field changes to **Digitally signed** and displays:
   - signer email
   - accepted timestamp
   - signature ID
10. Open `/ledger` to inspect the wallet challenge payload and the local envelope index.

This is a demo e-signature pattern, not a replacement for legal review of digital signature requirements. In production, use durable document storage, tamper-evident hash binding for the exact PDF bytes, retention policy, and a reviewed legal signature ceremony.

The landing page also includes **Use wallet-only lab** if you want to show the original Aegis wallet challenge as the sign-in step instead of Microsoft Verified ID or YubiKey.

## Azure Deployment

Deploy Aegis ID first so the Verified ID presentation callbacks and `/api/transactions/:id` endpoint are available:

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/deploy-azure-webapp.sh --env prod
```

Then deploy this standalone app. The script loads `examples/business-expenses/.env` for `--env prod`, `.env.dev` for `--env dev`, and `.env.qa` for `--env qa`.

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/deploy-azure-business-expenses.sh --env prod
```

The script targets:

```text
https://vanguard-business-expenses-65067d.azurewebsites.net
```

It sets:

```text
AEGIS_ID_BASE_URL=https://vanguard-aegis-id-65067d.azurewebsites.net
VERIFIED_ID_AUTH_ENABLED=true
YUBIKEY_AUTH_ENABLED=true
OIDC_CLIENT_ID=business-expenses-demo
AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED=false
```

The app uses browser PDF.js from jsDelivr for the PDF template designer and envelope preview. The deploy script packages the app code only; Azure installs Node dependencies and serves the browser assets at runtime.

Future dev/QA deployments use their own env files and must have a matching Aegis organization workspace ID before deploying:

```bash
bash scripts/deploy-azure-business-expenses.sh --env dev
bash scripts/deploy-azure-business-expenses.sh --env qa
```

For a second Azure tenant, seed the tenant profile from the repo root, create the Aegis ID environment first, then set the organization ID in the matching Business Expenses env file:

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/configure-tenant-profile.sh --tenant vanguardcs

bash scripts/provision-azure-lab-env.sh --env prod --tenant vanguardcs
bash scripts/deploy-azure-webapp.sh --env prod --tenant vanguardcs
```

After creating the production organization workspace in the new Aegis ID tenant, set:

```env
TENANT_VANGUARDCS_AEGIS_ORGANIZATION_ID=<organization-workspace-id>
```

Then deploy the example app:

```bash
bash scripts/deploy-azure-business-expenses.sh --env prod --tenant vanguardcs
```

Use the same pattern for `dev` and `qa` after their workspaces exist.

## Payload Shape

Each expense decision challenge stores a payload similar to:

```json
{
  "appName": "Business Expenses",
  "action": "approve",
  "timestamp": "2026-06-16T12:00:00.000Z",
  "actor": "identity@vanguardcs.ca",
  "expense": {
    "id": "EXP-2026-1001",
    "requester": "Maya Singh",
    "department": "Delivery",
    "vendor": "Azure Marketplace",
    "category": "Cloud Services",
    "amount": "CAD 1845.75"
  }
}
```

That payload is retained in the Aegis wallet challenge ledger and displayed in the iOS wallet.

Each document signature challenge stores a payload similar to:

```json
{
  "appName": "Vanguard E-Signatures",
  "action": "sign-document",
  "timestamp": "2026-06-18T12:00:00.000Z",
  "actor": {
    "name": "Frederick Pearson",
    "email": "fpearson@vanguardcs.ca"
  },
  "document": {
    "templateId": "e8cf70c6-0b87-4ed1-97a7-28a5f79db8f5",
    "templateName": "Contract approval",
    "fileName": "contract.pdf"
  },
  "signature": {
    "id": "SIG-8A9C1120F2BA77D1",
    "field": {
      "page": 1,
      "x": 0.12,
      "y": 0.68,
      "width": 0.34,
      "height": 0.12
    }
  }
}
```

After the wallet accepts the challenge, the envelope is marked `signed` and the rendered field displays the signer, timestamp, and signature ID.
