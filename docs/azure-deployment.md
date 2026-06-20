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

## Tenant Profiles

The deploy and provision scripts also support tenant-scoped env overlays. This lets the same `.env`, `.env.dev`, and `.env.qa` files carry multiple Azure tenant configurations without replacing the original Vanguard pilot values.

Seed the new tenant profile that uses tenant ID `6b4b0578-e6a2-4693-8f4c-af55cb10de87`:

```bash
cd /Users/frederickpearson/repos/aegis-id
bash scripts/configure-tenant-profile.sh --tenant vanguardcs
```

The script writes `TENANT_VANGUARDCS_*` values into:

- `.env`, `.env.dev`, `.env.qa`
- `examples/business-expenses/.env`, `.env.dev`, `.env.qa`

The seeded profile uses the subscription suffix `0e75d1` for globally unique Azure names:

| Env | Aegis ID app | Business app |
| --- | --- | --- |
| `prod` | `vanguard-aegis-id-0e75d1` | `vanguard-business-expenses-0e75d1` |
| `dev` | `vanguard-aegis-id-dev-0e75d1` | `vanguard-business-expenses-dev-0e75d1` |
| `qa` | `vanguard-aegis-id-qa-0e75d1` | `vanguard-business-expenses-qa-0e75d1` |

The Aegis ID app and Business Expenses app share the Aegis ID App Service plan by default. This avoids Azure failing with `FreeLinuxSkuNotAllowedInResourceGroup` when a second Free Linux App Service plan is requested in the same resource group.

If Azure still blocks Free Linux in the target subscription or region, rerun provisioning with a paid Basic plan override:

```bash
APP_SERVICE_SKU_NAME=B1 APP_SERVICE_SKU_TIER=Basic \
  bash scripts/provision-azure-lab-env.sh --env prod --tenant vanguardcs
```

Fresh Azure subscriptions may also need resource providers registered before App Service or ACA-Py Azure Container Instances can be created. The provision script registers these automatically after selecting the subscription:

```bash
az provider register --namespace Microsoft.Web --wait
az provider register --namespace Microsoft.ContainerInstance --wait
```

If your account cannot register providers, ask a subscription Owner to run those two commands once.

Fill these tenant-prefixed values manually before provisioning or deploying:

```env
TENANT_VANGUARDCS_AZURE_CLIENT_SECRET=
TENANT_VANGUARDCS_VID_CALLBACK_API_KEY=
TENANT_VANGUARDCS_SESSION_SECRET=
```

The ACA-Py admin key can be left blank for first provisioning. The provision script will generate and store it:

```env
TENANT_VANGUARDCS_ARIES_ADMIN_API_KEY=
```

After you create an organization workspace in each deployed Aegis ID environment, update the matching Business Expenses env file:

```env
TENANT_VANGUARDCS_AEGIS_ORGANIZATION_ID=<organization-workspace-id>
```

You can target the profile by alias or tenant ID:

```bash
bash scripts/deploy-azure-webapp.sh --env prod --tenant vanguardcs
bash scripts/deploy-azure-webapp.sh --env prod --tenant 6b4b0578-e6a2-4693-8f4c-af55cb10de87
```

To add another tenant later, rerun the profile script with a different alias and values:

```bash
bash scripts/configure-tenant-profile.sh \
  --tenant contoso \
  --tenant-id "<tenant-id>" \
  --subscription-id "<subscription-id>" \
  --client-id "<verified-id-app-registration-client-id>" \
  --authority-did "<verified-id-authority-did>" \
  --manifest-url "<verified-id-manifest-url>" \
  --credential-type "VerifiedEmployee" \
  --resource-suffix "<globally-unique-suffix>"
```

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

## Provision Dev, QA, Or Prod From Scratch

The deploy scripts refresh existing App Services. Use the provision script once per environment to create the resource group, App Services, ACA-Py Azure Container Instances, and env-file values. Then use the deploy scripts for normal code refreshes.

### Scripted Provisioning

For dev:

```bash
cd /Users/frederickpearson/repos/aegis-id

az login --tenant 24a46daa-7b87-4566-9eea-281326a1b75c
az account set --subscription 7719c366-5f64-439a-a6c6-65067d5a97e4

bash scripts/provision-azure-lab-env.sh --env dev
```

For QA:

```bash
cd /Users/frederickpearson/repos/aegis-id

az login --tenant 24a46daa-7b87-4566-9eea-281326a1b75c
az account set --subscription 7719c366-5f64-439a-a6c6-65067d5a97e4

bash scripts/provision-azure-lab-env.sh --env qa
```

For the additional `vanguardcs` tenant profile:

```bash
cd /Users/frederickpearson/repos/aegis-id

az login --tenant 6b4b0578-e6a2-4693-8f4c-af55cb10de87
az account set --subscription 93471fe7-92b9-43a5-85b3-72b0ee0e75d1

bash scripts/provision-azure-lab-env.sh --env prod --tenant vanguardcs
bash scripts/provision-azure-lab-env.sh --env dev --tenant vanguardcs
bash scripts/provision-azure-lab-env.sh --env qa --tenant vanguardcs
```

The provision script generates the shared ACA-Py admin API key automatically when `ARIES_ADMIN_API_KEY` is blank. It stores the key in the selected env file, or in the tenant-prefixed key when `--tenant` is used, and uses it for all four lab agents. To supply your own key instead:

```bash
export ARIES_ADMIN_API_KEY="$(openssl rand -hex 32)"

bash scripts/provision-azure-lab-env.sh \
  --env dev \
  --admin-api-key "$ARIES_ADMIN_API_KEY"
```

If you lose the key or want a clean ACA-Py lab wallet state:

```bash
bash scripts/provision-azure-lab-env.sh \
  --env dev \
  --recreate-containers
```

After provisioning, deploy code:

```bash
bash scripts/deploy-azure-webapp.sh --env dev
```

For a tenant profile, include the same `--tenant` flag:

```bash
bash scripts/deploy-azure-webapp.sh --env prod --tenant vanguardcs
bash scripts/deploy-azure-webapp.sh --env dev --tenant vanguardcs
bash scripts/deploy-azure-webapp.sh --env qa --tenant vanguardcs
```

Then create an organization workspace in the dev/QA Aegis ID web app, copy the organization ID into the matching `examples/business-expenses/.env.dev` or `.env.qa`, and deploy the standalone example app:

```bash
bash scripts/deploy-azure-business-expenses.sh --env dev
```

For the `vanguardcs` tenant profile, update `TENANT_VANGUARDCS_AEGIS_ORGANIZATION_ID` in the matching Business Expenses env file, then deploy:

```bash
bash scripts/deploy-azure-business-expenses.sh --env prod --tenant vanguardcs
bash scripts/deploy-azure-business-expenses.sh --env dev --tenant vanguardcs
bash scripts/deploy-azure-business-expenses.sh --env qa --tenant vanguardcs
```

### Manual Provisioning Reference

The examples below use `dev`. To create QA, change:

| Dev value | QA value |
| --- | --- |
| `dev` | `qa` |
| `rg-vanguard-aegis-id-dev` | `rg-vanguard-aegis-id-qa` |
| `vanguard-aegis-id-dev-65067d` | `vanguard-aegis-id-qa-65067d` |
| `vanguard-business-expenses-dev-65067d` | `vanguard-business-expenses-qa-65067d` |
| `.env.dev` | `.env.qa` |
| `examples/business-expenses/.env.dev` | `examples/business-expenses/.env.qa` |

### 1. Set Environment Variables

```bash
cd /Users/frederickpearson/repos/aegis-id

export AEGIS_ENV=dev
export AZURE_LOCATION=canadacentral
export AZURE_TENANT_ID=24a46daa-7b87-4566-9eea-281326a1b75c
export AZURE_SUBSCRIPTION_ID=7719c366-5f64-439a-a6c6-65067d5a97e4
export AZURE_RESOURCE_GROUP=rg-vanguard-aegis-id-dev
export AEGIS_WEBAPP_NAME=vanguard-aegis-id-dev-65067d
export BUSINESS_WEBAPP_NAME=vanguard-business-expenses-dev-65067d
export APP_SERVICE_PLAN_NAME="${AEGIS_WEBAPP_NAME}-plan"
export BUSINESS_APP_SERVICE_PLAN_NAME="$APP_SERVICE_PLAN_NAME"
export APP_SERVICE_SKU_NAME=F1
export APP_SERVICE_SKU_TIER=Free

export ARIES_HOLDER_NAME=vanguard-aegis-holder-dev-65067d
export ARIES_ISSUER_NAME=vanguard-aegis-issuer-dev-65067d
export ARIES_VERIFIER_NAME=vanguard-aegis-verifier-dev-65067d
export ARIES_MEDIATOR_NAME=vanguard-aegis-mediator-dev-65067d

export ARIES_HOLDER_FQDN="${ARIES_HOLDER_NAME}.${AZURE_LOCATION}.azurecontainer.io"
export ARIES_ISSUER_FQDN="${ARIES_ISSUER_NAME}.${AZURE_LOCATION}.azurecontainer.io"
export ARIES_VERIFIER_FQDN="${ARIES_VERIFIER_NAME}.${AZURE_LOCATION}.azurecontainer.io"
export ARIES_MEDIATOR_FQDN="${ARIES_MEDIATOR_NAME}.${AZURE_LOCATION}.azurecontainer.io"

export ACAPY_IMAGE=ghcr.io/openwallet-foundation/acapy-agent:1.6
export ARIES_ADMIN_API_KEY="$(openssl rand -hex 32)"
export HOLDER_WALLET_KEY="$(openssl rand -hex 32)"
export ISSUER_WALLET_KEY="$(openssl rand -hex 32)"
export VERIFIER_WALLET_KEY="$(openssl rand -hex 32)"
export MEDIATOR_WALLET_KEY="$(openssl rand -hex 32)"
```

For QA, set `AEGIS_ENV=qa` and replace each `-dev-` name with `-qa-`.

### 2. Create The Resource Group

```bash
az login --tenant "$AZURE_TENANT_ID"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

az group create \
  --name "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION"
```

### 3. Create The Aegis ID App Service

```bash
az deployment group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --template-file infra/bicep/main.bicep \
  --parameters \
    appName="$AEGIS_WEBAPP_NAME" \
    appServicePlanName="$APP_SERVICE_PLAN_NAME" \
    skuName="$APP_SERVICE_SKU_NAME" \
    skuTier="$APP_SERVICE_SKU_TIER" \
    publicBaseUrl="https://${AEGIS_WEBAPP_NAME}.azurewebsites.net" \
    sessionSecret="$(openssl rand -hex 32)" \
    azureTenantId="$AZURE_TENANT_ID"
```

### 4. Create The Example App Service

Use the same App Service Bicep baseline to create the second Node.js App Service. The Business Expenses deploy script replaces the Aegis-specific app settings with the standalone example app settings later. The app currently hosts both **Expense Approvals** and **E-Signatures**.

When both apps are in the same resource group, reuse the Aegis ID plan for the Business Expenses app. This is the recommended free-tier-friendly layout.

```bash
az deployment group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --template-file infra/bicep/main.bicep \
  --parameters \
    appName="$BUSINESS_WEBAPP_NAME" \
    appServicePlanName="$BUSINESS_APP_SERVICE_PLAN_NAME" \
    skuName="$APP_SERVICE_SKU_NAME" \
    skuTier="$APP_SERVICE_SKU_TIER" \
    publicBaseUrl="https://${BUSINESS_WEBAPP_NAME}.azurewebsites.net" \
    sessionSecret="$(openssl rand -hex 32)" \
    azureTenantId="$AZURE_TENANT_ID"
```

### 5. Create The ACA-Py Holder Container

The holder is a hosted lab stand-in for the mobile wallet bridge. It exposes inbound DIDComm on `6010` and admin on `6011`.

```bash
az container create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$ARIES_HOLDER_NAME" \
  --image "$ACAPY_IMAGE" \
  --location "$AZURE_LOCATION" \
  --os-type Linux \
  --cpu 1 \
  --memory 1.5 \
  --restart-policy OnFailure \
  --ip-address Public \
  --dns-name-label "$ARIES_HOLDER_NAME" \
  --ports 6010 6011 \
  --secure-environment-variables \
    ACAPY_ADMIN_API_KEY="$ARIES_ADMIN_API_KEY" \
    ACAPY_WALLET_KEY="$HOLDER_WALLET_KEY" \
  --command-line "sh -c 'aca-py start --label \"Vanguard Aegis Holder ${AEGIS_ENV}\" --inbound-transport http 0.0.0.0 6010 --outbound-transport http --admin 0.0.0.0 6011 --admin-api-key \"\$ACAPY_ADMIN_API_KEY\" --endpoint http://${ARIES_HOLDER_FQDN}:6010 --no-ledger --wallet-type askar --wallet-name holder-wallet-${AEGIS_ENV} --wallet-key \"\$ACAPY_WALLET_KEY\" --auto-provision --auto-accept-invites --auto-accept-requests --auto-ping-connection'"
```

### 6. Create The ACA-Py Issuer Container

The issuer creates org invitations and sends wallet challenges. It exposes inbound DIDComm on `4010` and admin on `4011`.

```bash
az container create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$ARIES_ISSUER_NAME" \
  --image "$ACAPY_IMAGE" \
  --location "$AZURE_LOCATION" \
  --os-type Linux \
  --cpu 1 \
  --memory 1.5 \
  --restart-policy OnFailure \
  --ip-address Public \
  --dns-name-label "$ARIES_ISSUER_NAME" \
  --ports 4010 4011 \
  --secure-environment-variables \
    ACAPY_ADMIN_API_KEY="$ARIES_ADMIN_API_KEY" \
    ACAPY_WALLET_KEY="$ISSUER_WALLET_KEY" \
  --command-line "sh -c 'aca-py start --label \"Vanguard Aries Issuer ${AEGIS_ENV}\" --inbound-transport http 0.0.0.0 4010 --outbound-transport http --admin 0.0.0.0 4011 --admin-api-key \"\$ACAPY_ADMIN_API_KEY\" --endpoint http://${ARIES_ISSUER_FQDN}:4010 --no-ledger --wallet-type askar --wallet-name issuer-wallet-${AEGIS_ENV} --wallet-key \"\$ACAPY_WALLET_KEY\" --auto-provision --auto-accept-invites --auto-accept-requests --auto-ping-connection'"
```

### 7. Create The ACA-Py Verifier Container

The verifier is used for proof-request and verifier challenge experiments. It exposes inbound DIDComm on `5010` and admin on `5011`.

```bash
az container create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$ARIES_VERIFIER_NAME" \
  --image "$ACAPY_IMAGE" \
  --location "$AZURE_LOCATION" \
  --os-type Linux \
  --cpu 1 \
  --memory 1.5 \
  --restart-policy OnFailure \
  --ip-address Public \
  --dns-name-label "$ARIES_VERIFIER_NAME" \
  --ports 5010 5011 \
  --secure-environment-variables \
    ACAPY_ADMIN_API_KEY="$ARIES_ADMIN_API_KEY" \
    ACAPY_WALLET_KEY="$VERIFIER_WALLET_KEY" \
  --command-line "sh -c 'aca-py start --label \"Vanguard Aries Verifier ${AEGIS_ENV}\" --inbound-transport http 0.0.0.0 5010 --outbound-transport http --admin 0.0.0.0 5011 --admin-api-key \"\$ACAPY_ADMIN_API_KEY\" --endpoint http://${ARIES_VERIFIER_FQDN}:5010 --no-ledger --wallet-type askar --wallet-name verifier-wallet-${AEGIS_ENV} --wallet-key \"\$ACAPY_WALLET_KEY\" --auto-provision --auto-accept-invites --auto-accept-requests --auto-ping-connection'"
```

### 8. Create The ACA-Py Mediator Container

The mediator is available for mediation experiments. It exposes inbound DIDComm on `3010` and admin on `3011`.

```bash
az container create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$ARIES_MEDIATOR_NAME" \
  --image "$ACAPY_IMAGE" \
  --location "$AZURE_LOCATION" \
  --os-type Linux \
  --cpu 1 \
  --memory 1.5 \
  --restart-policy OnFailure \
  --ip-address Public \
  --dns-name-label "$ARIES_MEDIATOR_NAME" \
  --ports 3010 3011 \
  --secure-environment-variables \
    ACAPY_ADMIN_API_KEY="$ARIES_ADMIN_API_KEY" \
    ACAPY_WALLET_KEY="$MEDIATOR_WALLET_KEY" \
  --command-line "sh -c 'aca-py start --label \"Vanguard Aries Mediator ${AEGIS_ENV}\" --inbound-transport http 0.0.0.0 3010 --outbound-transport http --admin 0.0.0.0 3011 --admin-api-key \"\$ACAPY_ADMIN_API_KEY\" --endpoint http://${ARIES_MEDIATOR_FQDN}:3010 --no-ledger --wallet-type askar --wallet-name mediator-wallet-${AEGIS_ENV} --wallet-key \"\$ACAPY_WALLET_KEY\" --auto-provision --open-mediation'"
```

### 9. Confirm ACA-Py FQDNs

```bash
for name in "$ARIES_HOLDER_NAME" "$ARIES_ISSUER_NAME" "$ARIES_VERIFIER_NAME" "$ARIES_MEDIATOR_NAME"; do
  az container show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$name" \
    --query "{name:name,fqdn:ipAddress.fqdn,ports:ipAddress.ports[].port,state:containers[0].instanceView.currentState.state}" \
    --output table
done
```

You should see:

```text
vanguard-aegis-holder-dev-65067d.canadacentral.azurecontainer.io
vanguard-aegis-issuer-dev-65067d.canadacentral.azurecontainer.io
vanguard-aegis-verifier-dev-65067d.canadacentral.azurecontainer.io
vanguard-aegis-mediator-dev-65067d.canadacentral.azurecontainer.io
```

### 10. Prepare `.env.dev` Or `.env.qa`

After both App Services and the four ACA-Py containers exist, run the environment preparer. It verifies the Azure resources, resolves the ACA-Py container FQDNs, updates the Aries admin URLs in the selected env file, and validates ACA-Py `/status`.

Use the same `ARIES_ADMIN_API_KEY` value you used when creating the ACA-Py containers.

For dev:

```bash
cd /Users/frederickpearson/repos/aegis-id

bash scripts/prepare-azure-lab-env.sh \
  --env dev \
  --admin-api-key "$ARIES_ADMIN_API_KEY"
```

For QA:

```bash
cd /Users/frederickpearson/repos/aegis-id

bash scripts/prepare-azure-lab-env.sh \
  --env qa \
  --admin-api-key "$ARIES_ADMIN_API_KEY"
```

If you only want to write the URLs and defer live ACA-Py validation, add `--skip-admin-check`.

The script updates:

```text
.env.dev or .env.qa
examples/business-expenses/.env.dev or examples/business-expenses/.env.qa
```

It does not invent `AEGIS_ORGANIZATION_ID`; create the organization workspace in the Aegis ID web app first, then add that organization ID to the matching Business Expenses env file.

Manual equivalent values for dev:

For dev:

```env
ARIES_HOLDER_ADMIN_URL=http://vanguard-aegis-holder-dev-65067d.canadacentral.azurecontainer.io:6011
ARIES_ISSUER_ADMIN_URL=http://vanguard-aegis-issuer-dev-65067d.canadacentral.azurecontainer.io:4011
ARIES_VERIFIER_ADMIN_URL=http://vanguard-aegis-verifier-dev-65067d.canadacentral.azurecontainer.io:5011
ARIES_MEDIATOR_ADMIN_URL=http://vanguard-aegis-mediator-dev-65067d.canadacentral.azurecontainer.io:3011
ARIES_ADMIN_API_KEY=<the ARIES_ADMIN_API_KEY value generated above>
```

For QA, use the matching `-qa-` FQDNs in `.env.qa`.

If you use different keys per agent instead of one shared lab key, set:

```env
ARIES_HOLDER_ADMIN_API_KEY=<holder-key>
ARIES_ISSUER_ADMIN_API_KEY=<issuer-key>
ARIES_VERIFIER_ADMIN_API_KEY=<verifier-key>
ARIES_MEDIATOR_ADMIN_API_KEY=<mediator-key>
```

### 11. Deploy Aegis ID

```bash
bash scripts/deploy-azure-webapp.sh --env dev
```

For QA:

```bash
bash scripts/deploy-azure-webapp.sh --env qa
```

### 12. Create An Organization Workspace

Open the dev or QA Aegis ID web app, register/sign in, subscribe an organization, and copy the workspace ID from the dashboard URL or organization dashboard context.

Put that value into the matching Business Expenses env file:

```env
# examples/business-expenses/.env.dev
AEGIS_ORGANIZATION_ID=<dev-aegis-organization-workspace-id>
```

For QA:

```env
# examples/business-expenses/.env.qa
AEGIS_ORGANIZATION_ID=<qa-aegis-organization-workspace-id>
```

### 13. Deploy The Standalone Example App

```bash
bash scripts/deploy-azure-business-expenses.sh --env dev
```

For QA:

```bash
bash scripts/deploy-azure-business-expenses.sh --env qa
```

The deployed example app landing page contains:

- **Expense Approvals:** table-driven approve/reject decisions signed with Aegis wallet challenges.
- **E-Signatures:** PDF template upload, signature-field placement with PDF.js, wallet signature challenge, signed envelope stamp, and ledger evidence.

### 14. Refresh Later Deploys

After the Azure resources exist, normal refreshes are:

```bash
bash scripts/deploy-azure-webapp.sh --env dev
bash scripts/deploy-azure-business-expenses.sh --env dev

bash scripts/deploy-azure-webapp.sh --env qa
bash scripts/deploy-azure-business-expenses.sh --env qa
```

### ACA-Py Lab Notes

- Azure Container Instances are not the same as production-grade ACA-Py hosting. Treat these as ephemeral lab agents.
- The commands above use `--admin-api-key`; keep the generated value private.
- The ACA-Py admin endpoints are HTTP and public in this simple lab. For production, put admin APIs behind private networking, TLS, and stricter ingress controls.
- ACI filesystem state is ephemeral. Recreating a container creates a new wallet unless you add persistent storage.
- If a container command or wallet key changes, delete and recreate the container:

  ```bash
  az container delete \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$ARIES_ISSUER_NAME" \
    --yes
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
    BUSINESS_EXPENSES_APP_URL=https://vanguard-business-expenses-65067d.azurewebsites.net \
    IOS_TESTFLIGHT_PUBLIC_URL="<testflight-public-link-if-enabled>" \
    ANDROID_TESTING_URL="<google-play-testing-link-if-enabled>" \
    PASSKEY_RP_ID=vanguard-aegis-id-65067d.azurewebsites.net \
    PASSKEY_ORIGIN=https://vanguard-aegis-id-65067d.azurewebsites.net \
    IOS_APP_TEAM_ID=GL46AP73ZQ \
    IOS_APP_BUNDLE_ID=ca.vanguardcs.aegisid.wallet \
    ANDROID_APP_PACKAGE_NAME=ca.vanguardcs.aegisid.wallet \
    ANDROID_SHA256_CERT_FINGERPRINTS="<android-upload-or-app-signing-sha256>"
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
| `BUSINESS_EXPENSES_APP_URL` | Signed-in home-page link to the standalone example app with Expense Approval and E-Signature demos. |
| `IOS_TESTFLIGHT_PUBLIC_URL` | Optional TestFlight public invitation link for the homepage iOS download badge. Use the dev or QA TestFlight link in `.env.dev` / `.env.qa` when publishing separate mobile builds. |
| `ANDROID_TESTING_URL` | Optional Google Play internal sharing or testing link for the homepage Android download badge. |
| `PASSKEY_RP_ID` | WebAuthn relying-party ID for dashboard and mobile wallet passkeys. Use the Azure host only. |
| `PASSKEY_ORIGIN` | WebAuthn origin for verifying passkey ceremonies. Use the full HTTPS origin. |
| `WALLET_PASSKEY_STORE_PATH` | JSON pilot store for mobile wallet passkey registrations. Use `/home/data/wallet-passkeys.json` for Azure persistence. |
| `IOS_APP_TEAM_ID` / `IOS_APP_BUNDLE_ID` | Values published by `/.well-known/apple-app-site-association` so iOS can bind wallet passkeys to the Aegis ID domain. |
| `ANDROID_APP_PACKAGE_NAME` / `ANDROID_SHA256_CERT_FINGERPRINTS` | Values published by `/.well-known/assetlinks.json` so Android can bind Credential Manager passkeys to the Aegis ID domain. |

## Mobile Passkey Association

The web deploy script serves and verifies both association endpoints:

```text
https://<aegis-host>/.well-known/apple-app-site-association
https://<aegis-host>/.well-known/assetlinks.json
```

For iOS, keep `IOS_APP_TEAM_ID` and `IOS_APP_BUNDLE_ID` aligned with the Apple Developer team and bundle identifier used by the signed wallet app.

For Android, set `ANDROID_SHA256_CERT_FINGERPRINTS` to the SHA-256 certificate fingerprint for the upload key or app-signing certificate used by the build you distribute. Multiple values can be comma-separated during a transition.

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
