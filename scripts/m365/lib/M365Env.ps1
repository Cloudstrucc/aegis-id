# Shared by the PowerShell scripts in scripts/m365/. Dot-source it:  . "$PSScriptRoot/lib/M365Env.ps1"
#
# The PowerShell twin of lib/common.sh: reads one environment's dotenv file and works out the
# Microsoft 365 names every step uses. The rules must match common.sh; change both together.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:M365Dir = Split-Path -Parent $PSScriptRoot
$script:RepoRoot = Split-Path -Parent (Split-Path -Parent $script:M365Dir)

function Resolve-M365EnvFile([string]$Name) {
  switch ($Name) {
    { $_ -in 'prod', 'production' } { return Join-Path $script:RepoRoot '.env' }
    { $_ -in 'local', 'localhost' } { return Join-Path $script:RepoRoot '.env.local' }
    { $_ -in 'dev', 'development' } { return Join-Path $script:RepoRoot '.env.dev' }
    { $_ -in 'qa', 'test' } { return Join-Path $script:RepoRoot '.env.qa' }
    default { return $Name }
  }
}

# KEY=VALUE lines into a hashtable. Comments and blank lines are skipped, one pair of matching
# quotes is stripped, and a key written twice stops: which line was meant is not knowable here.
function Read-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "env file not found: $Path" }
  $vars = @{}
  foreach ($raw in Get-Content -LiteralPath $Path) {
    $line = $raw.TrimEnd("`r")
    if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }
    $line = $line -replace '^\s*export\s+', ''
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $key = $Matches[1]; $value = $Matches[2]
    if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") { $value = $Matches[1] }
    if ($vars.ContainsKey($key)) { throw "$key is set twice in $Path. Delete the one you do not mean." }
    $vars[$key] = $value
  }
  return $vars
}

function Get-AddressOf([string]$Value) {
  if (-not $Value) { return '' }
  if ($Value -match '<([^>]+)>') { $Value = $Matches[1] }
  return ($Value -replace '\s', '').ToLowerInvariant()
}
function Get-DomainOf([string]$Value) {
  $a = Get-AddressOf $Value
  if ($a -match '@(.+)$') { return $Matches[1] } else { return '' }
}

# Returns a hashtable: EnvName EnvFile Domain AppSlug DisplayName AppName Sender Help SenderGroup
# Owners (string[]) AdminUpn ClientId TenantId DmarcRua. Throws a sentence on bad config.
function Import-M365Env([string]$Name) {
  if (-not $Name) { throw '-Env is required (local, dev, qa, prod, or a path to an env file)' }
  $file = Resolve-M365EnvFile $Name
  $v = Read-DotEnv $file
  $get = { param($k) if ($v.ContainsKey($k)) { [string]$v[$k] } else { '' } }
  $envName = switch ($Name) { { $_ -in 'prod', 'production' } { 'prod' } { $_ -in 'dev', 'development' } { 'dev' }
    { $_ -in 'qa', 'test' } { 'qa' } { $_ -in 'local', 'localhost' } { 'local' } default { '' } }

  $domain = (& $get 'M365_DOMAIN')
  if (-not $domain) { $domain = Get-DomainOf (& $get 'GRAPH_SENDER') }
  $domain = $domain.ToLowerInvariant()
  if (-not $domain) { throw "set M365_DOMAIN (e.g. vanguardcs.ca or cloudstrucc.com) in $file" }
  $slug = & $get 'M365_APP_SLUG'
  if (-not $slug) { throw "set M365_APP_SLUG in ${file}: a short lowercase name for this app (e.g. aegis). It keeps this app's mailboxes and group apart from other apps on the same tenant." }
  if ($slug -cnotmatch '^[a-z0-9][a-z0-9-]*$') { throw 'M365_APP_SLUG must be lowercase letters, digits and hyphens' }

  $from = & $get 'EMAIL_FROM'
  $fromName = if ($from -match '^\s*([^<]*?)\s*<') { $Matches[1] } else { '' }
  $display = & $get 'M365_DISPLAY_NAME'; if (-not $display) { $display = if ($fromName) { $fromName } else { $slug } }
  $appName = & $get 'M365_APP_NAME'; if (-not $appName) { $appName = "$display Mailer" }

  # One mailbox per environment: prod gets <slug>-noreply@, every other one <slug>-<env>-noreply@.
  $sender = Get-AddressOf (& $get 'GRAPH_SENDER')
  if (-not $sender) {
    if (-not $envName) { throw "set GRAPH_SENDER in $file (no default for an env file given by path)" }
    $sender = if ($envName -eq 'prod') { "$slug-noreply@$domain" } else { "$slug-$envName-noreply@$domain" }
  }
  $help = Get-AddressOf (& $get 'EMAIL_HELP')
  $group = Get-AddressOf (& $get 'M365_SENDER_GROUP'); if (-not $group) { $group = "$slug-mail-senders@$domain" }
  $admin = & $get 'M365_ADMIN_UPN'
  $ownersRaw = & $get 'M365_MAILBOX_OWNERS'; if (-not $ownersRaw) { $ownersRaw = $admin }
  $owners = @($ownersRaw -split '[,\s]+' | Where-Object { $_ })

  foreach ($a in @($sender, $help, $group)) {
    if ($a -and (Get-DomainOf $a) -ne $domain) { throw "$a is not on M365_DOMAIN ($domain). Every address these scripts create lives on that one domain." }
  }
  if ($from -and (Get-AddressOf $from) -ne $sender) {
    throw "EMAIL_FROM's address ($(Get-AddressOf $from)) must be GRAPH_SENDER ($sender): Graph refuses a From it is not sending as"
  }
  return @{
    EnvName = $envName; EnvFile = $file; Domain = $domain; AppSlug = $slug; DisplayName = $display
    AppName = $appName; Sender = $sender; Help = $help; SenderGroup = $group; Owners = $owners
    AdminUpn = $admin; ClientId = (& $get 'GRAPH_CLIENT_ID'); TenantId = (& $get 'GRAPH_TENANT_ID')
    DmarcRua = (& $get 'M365_DMARC_RUA')
  }
}

function Write-M365Plan($c) {
  Write-Host "==> Environment file: $($c.EnvFile)" -ForegroundColor Cyan
  '    domain            {0}' -f $c.Domain
  '    app registration  {0}  (client id: {1})' -f $c.AppName, $(if ($c.ClientId) { 'set' } else { 'not set yet' })
  '    sends as          {0}  (GRAPH_SENDER)' -f $c.Sender
  '    help inbox        {0}' -f $(if ($c.Help) { $c.Help } else { '(none: EMAIL_HELP is not set)' })
  '    scope group       {0}' -f $c.SenderGroup
  '    mailbox owners    {0}' -f $(if ($c.Owners.Count) { $c.Owners -join ', ' } else { '(none: set M365_MAILBOX_OWNERS or M365_ADMIN_UPN)' })
}

# Signs in to Exchange Online once per PowerShell session; installs the module the first time.
function Connect-M365Exchange($c) {
  if (-not (Get-Module -ListAvailable ExchangeOnlineManagement)) {
    Write-Host '==> Installing the ExchangeOnlineManagement module (current user only)' -ForegroundColor Cyan
    Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
  }
  Import-Module ExchangeOnlineManagement
  $live = @(Get-ConnectionInformation -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Connected' })
  if ($live.Count) { return }
  if ($c.AdminUpn) { Connect-ExchangeOnline -UserPrincipalName $c.AdminUpn -ShowBanner:$false }
  else { Connect-ExchangeOnline -ShowBanner:$false }
}

# The account signed in to Exchange, used as the "must be Denied" mailbox in access tests.
function Get-M365SignedInUpn {
  return (@(Get-ConnectionInformation | Where-Object { $_.State -eq 'Connected' })[0]).UserPrincipalName
}
