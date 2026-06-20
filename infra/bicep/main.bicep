@description('Azure region for the App Service resources.')
param location string = resourceGroup().location

@description('Globally unique App Service app name. Use lowercase letters, numbers, and hyphens.')
param appName string

@description('App Service plan name. Use the same value for multiple apps when they should share one plan.')
param appServicePlanName string = '${appName}-plan'

@description('App Service plan SKU. F1 keeps the web app on the Free tier where available.')
param skuName string = 'F1'

@description('App Service plan tier matching the SKU.')
param skuTier string = 'Free'

@description('Node runtime for App Service Linux.')
param linuxFxVersion string = 'NODE|22-lts'

@description('Public base URL for callbacks. Set to https://<appName>.azurewebsites.net after deployment unless using a custom domain.')
param publicBaseUrl string = 'https://${appName}.azurewebsites.net'

@secure()
@description('Express session secret for Passport.js authenticated sessions.')
param sessionSecret string

@description('Azure tenant ID used later for Microsoft Entra Verified ID live mode. The first deployment still runs in VID_MODE=mock.')
param azureTenantId string = ''

var defaultHostName = '${appName}.azurewebsites.net'
var dataRoot = '/home/data'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: skuName
    tier: skuTier
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      appCommandLine: 'npm start'
      alwaysOn: false
      ftpsState: 'FtpsOnly'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'PORT'
          value: '8080'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'PUBLIC_BASE_URL'
          value: publicBaseUrl
        }
        {
          name: 'VID_MODE'
          value: 'mock'
        }
        {
          name: 'AZURE_TENANT_ID'
          value: azureTenantId
        }
        {
          name: 'SESSION_SECRET'
          value: sessionSecret
        }
        {
          name: 'DEFAULT_MFA_METHOD'
          value: 'passkey'
        }
        {
          name: 'PASSKEY_RP_NAME'
          value: 'Vanguard Cloud Services - Aegis ID'
        }
        {
          name: 'PASSKEY_RP_ID'
          value: defaultHostName
        }
        {
          name: 'PASSKEY_ORIGIN'
          value: publicBaseUrl
        }
        {
          name: 'USER_STORE_PATH'
          value: '${dataRoot}/users.json'
        }
        {
          name: 'SUBSCRIPTION_STORE_PATH'
          value: '${dataRoot}/subscriptions.json'
        }
        {
          name: 'SUBSCRIBER_WORKSPACE_STORE_PATH'
          value: '${dataRoot}/subscriber-workspaces.json'
        }
        {
          name: 'TRANSACTION_STORE_PATH'
          value: '${dataRoot}/transactions.json'
        }
        {
          name: 'ISSUER_ORG_STORE_PATH'
          value: '${dataRoot}/issuer-organizations.json'
        }
        {
          name: 'ORG_ADMIN_STORE_PATH'
          value: '${dataRoot}/org-admin.json'
        }
        {
          name: 'ORG_ADMIN_EVENT_STORE_PATH'
          value: '${dataRoot}/org-admin-events.json'
        }
        {
          name: 'OIDC_WALLET_SESSION_STORE_PATH'
          value: '${dataRoot}/oidc-wallet-sessions.json'
        }
        {
          name: 'OIDC_CODE_STORE_PATH'
          value: '${dataRoot}/oidc-codes.json'
        }
        {
          name: 'WALLET_CHALLENGE_STORE_PATH'
          value: '${dataRoot}/wallet-challenges.json'
        }
        {
          name: 'WALLET_PASSKEY_STORE_PATH'
          value: '${dataRoot}/wallet-passkeys.json'
        }
        {
          name: 'AUDIT_STORE_PATH'
          value: '${dataRoot}/audit-events.json'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

output appUrl string = 'https://${site.properties.defaultHostName}'
output appName string = site.name
