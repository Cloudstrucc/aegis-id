# Azure Deployment

The app is designed to run as a Node.js Express app on Azure App Service. Microsoft Learn currently documents an App Service Free tier path for Node.js/Express quickstarts, and the Bicep template defaults to `F1`.

## Free-Tier Fit

The free-friendly baseline includes:

- Azure App Service Free `F1` for the public Node.js/HBS app.
- `VID_MODE=mock` for landing page, subscription capture, onboarding wizard, and local request demos.
- File-backed subscription and transaction capture under `data/`.
- No App Insights, Key Vault, database, private networking, or custom domain required for the first pilot.

Items that can move the solution out of free-tier territory:

- Production Key Vault and key lifecycle controls.
- App Insights or Log Analytics retention.
- Custom domains or TLS bindings beyond the default `azurewebsites.net` host.
- Durable storage such as Azure Table Storage, Cosmos DB, SQL, or CRM integration.
- Scale-out, deployment slots, Always On, or higher App Service SKUs.
- Verified ID tenant and request volume requirements beyond free allowances.

## CLI Deployment

```bash
az login
az account set --subscription "<subscription-id>"

az group create \
  --name rg-cloudstrucc-aegis-id \
  --location canadacentral

az deployment group create \
  --resource-group rg-cloudstrucc-aegis-id \
  --template-file infra/bicep/main.bicep \
  --parameters appName="<globally-unique-app-name>"
```

Deploy the application package:

```bash
npm ci
npm test
zip -r aegis-id.zip . \
  -x "node_modules/*" ".git/*" ".env" "data/*.json" "tmp/*"

az webapp deploy \
  --resource-group rg-cloudstrucc-aegis-id \
  --name "<globally-unique-app-name>" \
  --src-path aegis-id.zip \
  --type zip
```

Open:

```bash
az webapp browse \
  --resource-group rg-cloudstrucc-aegis-id \
  --name "<globally-unique-app-name>"
```

## Live Verified ID Settings

Set these App Service configuration values after the Entra app registration and Verified ID setup are complete:

```bash
az webapp config appsettings set \
  --resource-group rg-cloudstrucc-aegis-id \
  --name "<globally-unique-app-name>" \
  --settings \
    VID_MODE=live \
    AZURE_TENANT_ID="<tenant-id>" \
    AZURE_CLIENT_ID="<app-client-id>" \
    AZURE_CLIENT_SECRET="<client-secret>" \
    VID_AUTHORITY_DID="<issuer-did>" \
    VID_MANIFEST_URL="<credential-manifest-url>" \
    VID_CREDENTIAL_TYPE="CloudstruccEmployeeCredential" \
    VID_CALLBACK_API_KEY="<random-callback-secret>" \
    PUBLIC_BASE_URL="https://<globally-unique-app-name>.azurewebsites.net"
```

For a subscriber-driven Cloudstrucc Inc. pilot, the wizard can also accept tenant/app/DID/claims details in the dashboard. A live test still needs a client secret supplied one time in the wizard or configured in App Service settings. The wizard does not persist secrets.

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
