# Business Expenses Demo

Standalone Node.js/Express app showing how an organization can use Vanguard Aegis ID for:

- OIDC sign-in to a business application.
- Microsoft Entra Verified ID presentation on registration/sign-in.
- YubiKey 5C NFC / FIDO2 browser step-up on registration/sign-in.
- Wallet challenge for high-value approve/reject expense decisions.
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
6. Configure live Microsoft Entra Verified ID in Aegis ID and issue a `VerifiedEmployee` credential to Microsoft Authenticator.

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
5. Return to Business Expenses. The expense table opens.
6. Press **Approve** or **Reject** on an expense.
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

Future dev/QA deployments use their own env files and must have a matching Aegis organization workspace ID before deploying:

```bash
bash scripts/deploy-azure-business-expenses.sh --env dev
bash scripts/deploy-azure-business-expenses.sh --env qa
```

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
