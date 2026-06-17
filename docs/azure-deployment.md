# Azure Deployment

The app is designed to run as a Node.js Express app on Azure App Service. Microsoft Learn currently documents an App Service Free tier path for Node.js/Express quickstarts, and the Bicep template defaults to `F1`. The Azure Linux runtime currently uses Node 22 LTS, which satisfies the app's Node `>=20` engine requirement.

## Free-Tier Fit

The free-friendly baseline includes:

- Azure App Service Free `F1` for the public Node.js/HBS app.
- `VID_MODE=mock` for landing page, subscription capture, onboarding wizard, and local request demos.
- Passport.js subscriber registration with passkey MFA as the Azure pilot default.
- Email/SMS MFA UI is present, but production delivery needs a provider such as Azure Communication Services, Microsoft Graph mail, SendGrid, or Twilio before selecting those methods.
- File-backed user, subscription, organization, and transaction capture under `/home/data`.
- No App Insights, Key Vault, database, private networking, or custom domain required for the first pilot.

Items that can move the solution out of free-tier territory:

- Production Key Vault and key lifecycle controls.
- App Insights or Log Analytics retention.
- Custom domains or TLS bindings beyond the default `azurewebsites.net` host.
- Durable storage such as Azure Table Storage, Cosmos DB, SQL, or CRM integration.
- Scale-out, deployment slots, Always On, or higher App Service SKUs.
- Verified ID tenant and request volume requirements beyond free allowances.

## Environment Files

The deploy scripts choose an env file and push the relevant non-empty values into Azure App Service settings.

| Flag | Env file | Purpose |
| --- | --- | --- |
| `--env local` | `.env.local` | Localhost only; do not deploy this to Azure unless intentionally testing. |
| `--env dev` | `.env.dev` | Future dev Azure App Service. |
| `--env qa` | `.env.qa` | Future QA Azure App Service. |
| `--env prod` | `.env` | Production Azure App Service. |

You can also pass `--env-file /absolute/path/to/file` for one-off deploys. Existing shell variables override values from the selected env file.

Secrets are intentionally blank in templates. Fill in `SESSION_SECRET`, `AZURE_CLIENT_SECRET`, and `VID_CALLBACK_API_KEY` yourself. If these are blank, the web deploy script preserves the existing Azure setting when possible and generates `SESSION_SECRET` only when one does not already exist.

## CLI Deployment

```bash
az login
az account set --subscription "<subscription-id>"

az group create \
  --name rg-vanguard-aegis-id \
  --location canadacentral

az deployment group create \
  --resource-group rg-vanguard-aegis-id \
  --template-file infra/bicep/main.bicep \
  --parameters \
    appName="<globally-unique-app-name>" \
    sessionSecret="<strong-random-session-secret>" \
    azureTenantId="<tenant-id>"
```

Deploy or refresh the production application package:

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/deploy-azure-webapp.sh --env prod
```

Open:

```bash
az webapp browse \
  --resource-group rg-vanguard-aegis-id \
  --name "<globally-unique-app-name>"
```

## Live Verified ID Settings

Set these App Service configuration values after the Entra app registration and Verified ID setup are complete:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id \
  --name "<globally-unique-app-name>" \
  --settings \
    VID_MODE=live \
    AZURE_TENANT_ID="<tenant-id>" \
    AZURE_CLIENT_ID="<app-client-id>" \
    AZURE_CLIENT_SECRET="<client-secret>" \
    VID_AUTHORITY_DID="<issuer-did>" \
    VID_MANIFEST_URL="<credential-manifest-url>" \
    VID_CREDENTIAL_TYPE="VanguardEmployeeCredential" \
    VID_CALLBACK_API_KEY="<random-callback-secret>" \
    PUBLIC_BASE_URL="https://<globally-unique-app-name>.azurewebsites.net"
```

For the current Vanguard Azure pilot values:

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
    BUSINESS_EXPENSES_APP_URL=https://vanguard-business-expenses-65067d.azurewebsites.net
```

The same settings are represented in `.env` for production deploys. Use `.env.dev` and `.env.qa` for future environment-specific app names, URLs, data paths, and passkey origins.

Do not store real `AZURE_CLIENT_SECRET` or `VID_CALLBACK_API_KEY` values in source control. Set them directly in App Service configuration or move them to Key Vault before production use.

| Variable | Purpose |
| --- | --- |
| `VID_MODE` | Enables live Microsoft Entra Verified ID requests instead of local mock QR links. |
| `AZURE_TENANT_ID` | Tenant that owns the Verified ID authority and app registration. |
| `AZURE_CLIENT_ID` | App registration client ID used for MSAL client credentials. |
| `AZURE_CLIENT_SECRET` | Secret for the app registration. Rotate this regularly. |
| `VID_AUTHORITY_DID` | Verified ID issuer authority DID that must match the credential contract. |
| `VID_MANIFEST_URL` | Manifest URL from the Entra Verified ID credential contract. |
| `VID_CREDENTIAL_TYPE` | Credential type configured in the contract, such as `VerifiedEmployee`. |
| `VID_CALLBACK_API_KEY` | Shared callback key checked by the app when Microsoft sends status callbacks. |
| `PUBLIC_BASE_URL` / `APP_PUBLIC_BASE_URL` | Public app URL used for callbacks, QR links, and wallet handoffs. |
| `BUSINESS_EXPENSES_APP_URL` | Signed-in home-page link to the standalone Business Expenses demo. |

For a subscriber-driven Vanguard Cloud Services pilot, the wizard can also accept tenant/app/DID/claims details in the dashboard. A live test still needs a client secret supplied one time in the wizard or configured in App Service settings. The wizard does not persist secrets.

## Microsoft Setup Checklist

- Register a single-tenant Entra application.
- Grant the Verified ID Request Service application permission and admin consent.
- Create the Verified ID tenant setup and issuer DID.
- Configure the credential manifest/display/rules definition.
- Enable Passkey/FIDO2 for the pilot group.
- Apply Conditional Access with phishing-resistant authentication strength.
- Use the default `azurewebsites.net` HTTPS host for the first callback test.

## References

- Azure App Service Node.js quickstart: https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs
- Azure App Service plans: https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans
- Verified ID Request Service REST API: https://learn.microsoft.com/en-us/entra/verified-id/get-started-request-api
- Advanced Microsoft Entra Verified ID setup: https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-tenant
