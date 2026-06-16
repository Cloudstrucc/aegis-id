# Business Expenses Demo

Standalone Node.js/Express app showing how an organization can use Vanguard Aegis ID for:

- OIDC sign-in to a business application.
- Wallet challenge on registration/sign-in.
- Wallet challenge for high-value approve/reject expense decisions.
- Ledger reporting in the web app, Aegis ID dashboard, and iOS wallet.

## 1. Prerequisites

1. Start Aegis ID from the repo root:

   ```bash
   npm install
   npm run dev
   ```

2. In Aegis ID, create or open an organization dashboard.
3. Create an org issuer invitation from the dashboard.
4. Import and accept that invitation in the iOS wallet simulator.
5. Copy the organization workspace ID and set it as `AEGIS_ORGANIZATION_ID`.

The app can also target a raw issuer connection with `AEGIS_ISSUER_CONNECTION_ID`, but the recommended path is organization-scoped.

## 2. Configure

```bash
cd examples/business-expenses
cp .env.example .env
```

Edit `.env`:

```bash
AEGIS_ID_BASE_URL=http://localhost:3000
AEGIS_ORGANIZATION_ID=<your-aegis-organization-workspace-id>
APP_PUBLIC_BASE_URL=http://localhost:4300
```

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

1. Click **Register with Aegis ID** or **Sign in with Aegis ID**.
2. Authorize the OIDC request on the Aegis ID authorization screen.
3. The Business Expenses app creates an authentication wallet challenge.
4. In the iOS wallet:
   - Open the issuer connection.
   - Tap **Fetch OIDC challenges**.
   - Open the new challenge in **Ledger** or the connection transaction list.
   - Accept the challenge.
5. Return to Business Expenses. The expense table opens.
6. Press **Approve** or **Reject** on an expense.
7. Accept the new wallet challenge in the iOS wallet.
8. Review the signed action in:
   - Business Expenses `/ledger`
   - Aegis ID organization dashboard, **External app ledger**
   - iOS wallet **Ledger** tab

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
