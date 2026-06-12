@description('Azure region for the App Service resources.')
param location string = resourceGroup().location

@description('Globally unique App Service app name. Use lowercase letters, numbers, and hyphens.')
param appName string

@description('App Service plan SKU. F1 keeps the web app on the Free tier where available.')
param skuName string = 'F1'

@description('App Service plan tier matching the SKU.')
param skuTier string = 'Free'

@description('Node runtime for App Service Linux.')
param linuxFxVersion string = 'NODE|20-lts'

@description('Public base URL for callbacks. Set to https://<appName>.azurewebsites.net after deployment unless using a custom domain.')
param publicBaseUrl string = 'https://${appName}.azurewebsites.net'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
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
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

output appUrl string = 'https://${site.properties.defaultHostName}'
output appName string = site.name
