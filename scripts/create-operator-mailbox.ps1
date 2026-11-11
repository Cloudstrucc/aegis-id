<#
.SYNOPSIS
  Creates the Aegis ID platform operator's shared mailbox in Exchange Online
  and delegates it to a named administrator.

.DESCRIPTION
  `PLATFORM_OPERATOR_EMAILS` decides who may reach /admin — sign-in methods for
  the whole deployment, the mail and SMS transport, registration codes that
  grant a paid plan without payment, break-glass redemption, and the registers
  that list every wallet, domain and delivered message on the installation.

  Pointing it at a shared mailbox rather than a person is deliberate. The
  operator identity then outlives whoever currently holds the job, the
  delegation is managed in Exchange where the rest of the organization's access
  already is, and removing somebody is one `Remove-MailboxPermission` rather
  than a deployment change.

  A shared mailbox needs no licence under 50 GB and has no interactive sign-in
  of its own — which is fine, because Aegis ID accounts are its own. See
  "After this script" below: an Aegis account must exist for this address or
  nobody will be able to reach /admin at all.

  Idempotent. Run it again and it reports what already exists rather than
  failing.

.PARAMETER MailboxAddress
  The shared mailbox to create. Must match PLATFORM_OPERATOR_EMAILS.

.PARAMETER DelegateAddress
  Who gets Full Access and Send As. Repeatable.

.PARAMETER DisplayName
  What the mailbox is called in the address book.

.PARAMETER WhatIfOnly
  Report what would change and make no change.

.EXAMPLE
  pwsh ./scripts/create-operator-mailbox.ps1 `
    -MailboxAddress help-aegis-id@vanguardcs.ca `
    -DelegateAddress fpearson@vanguardcs.ca

.NOTES
  Needs the ExchangeOnlineManagement module and an account with the Exchange
  Administrator role.

      Install-Module ExchangeOnlineManagement -Scope CurrentUser
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $MailboxAddress,

  [Parameter(Mandatory = $true)]
  [string[]] $DelegateAddress,

  [string] $DisplayName = 'Aegis ID Platform Operator',

  [string] $Alias,

  [switch] $WhatIfOnly
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string] $Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Skip { param([string] $Message) Write-Host "    $Message" -ForegroundColor DarkGray }

if (-not $Alias) {
  $Alias = ($MailboxAddress -split '@')[0]
}

# ---------------------------------------------------------------------------
# Connect
# ---------------------------------------------------------------------------

Write-Step "Checking the Exchange Online module"
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  throw "ExchangeOnlineManagement is not installed. Run: Install-Module ExchangeOnlineManagement -Scope CurrentUser"
}
Import-Module ExchangeOnlineManagement -ErrorAction Stop
Write-Ok "Module available"

Write-Step "Connecting to Exchange Online"
# Reuse a live session rather than prompting again. Get-OrganizationConfig is
# the cheapest call that fails when there is no session.
$connected = $false
try {
  $org = Get-OrganizationConfig -ErrorAction Stop
  $connected = $true
  Write-Ok "Already connected to $($org.Name)"
} catch {
  $connected = $false
}
if (-not $connected) {
  Connect-ExchangeOnline -ShowBanner:$false
  $org = Get-OrganizationConfig
  Write-Ok "Connected to $($org.Name)"
}

# ---------------------------------------------------------------------------
# The mailbox
# ---------------------------------------------------------------------------

Write-Step "Shared mailbox $MailboxAddress"
$mailbox = Get-Mailbox -Identity $MailboxAddress -ErrorAction SilentlyContinue

if ($mailbox) {
  if ($mailbox.RecipientTypeDetails -ne 'SharedMailbox') {
    throw "$MailboxAddress already exists as $($mailbox.RecipientTypeDetails). Refusing to convert it — check the address."
  }
  Write-Skip "Already exists ($($mailbox.DisplayName))"
} elseif ($WhatIfOnly) {
  Write-Skip "Would create shared mailbox '$DisplayName' <$MailboxAddress> (alias $Alias)"
} else {
  $mailbox = New-Mailbox -Shared `
    -Name $DisplayName `
    -DisplayName $DisplayName `
    -Alias $Alias `
    -PrimarySmtpAddress $MailboxAddress
  Write-Ok "Created $($mailbox.PrimarySmtpAddress)"

  # Exchange takes a moment to make a new mailbox addressable; permissions
  # applied immediately afterwards fail with "object couldn't be found".
  Write-Skip "Waiting for the mailbox to become addressable"
  $ready = $false
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Seconds 6
    if (Get-Mailbox -Identity $MailboxAddress -ErrorAction SilentlyContinue) { $ready = $true; break }
  }
  if (-not $ready) {
    throw "The mailbox was created but is not addressable yet. Wait a minute and run this script again — it will pick up where it left off."
  }
  Write-Ok "Addressable"
}

# Keep a copy of anything sent as, or on behalf of, the mailbox in its own Sent
# Items. Without this a reply sent from the shared mailbox lands only in the
# delegate's personal Sent folder, and the next person to hold the job cannot
# see what was said.
if (-not $WhatIfOnly -and $mailbox) {
  Set-Mailbox -Identity $MailboxAddress `
    -MessageCopyForSentAsEnabled $true `
    -MessageCopyForSendOnBehalfEnabled $true
  Write-Ok "Sent mail is kept in the shared mailbox"
}

# ---------------------------------------------------------------------------
# Delegation
# ---------------------------------------------------------------------------

foreach ($delegate in $DelegateAddress) {
  Write-Step "Delegating to $delegate"

  if (-not (Get-Recipient -Identity $delegate -ErrorAction SilentlyContinue)) {
    throw "$delegate is not a recipient in this tenant. Check the address."
  }

  # Full Access — opens the mailbox. AutoMapping puts it in their Outlook on
  # its own, which is what makes the operator address something somebody
  # actually reads rather than an alias nobody opens.
  $hasFullAccess = Get-MailboxPermission -Identity $MailboxAddress -User $delegate -ErrorAction SilentlyContinue |
    Where-Object { $_.AccessRights -contains 'FullAccess' -and -not $_.Deny }

  if ($hasFullAccess) {
    Write-Skip "Full Access already granted"
  } elseif ($WhatIfOnly) {
    Write-Skip "Would grant Full Access (with AutoMapping)"
  } else {
    Add-MailboxPermission -Identity $MailboxAddress `
      -User $delegate `
      -AccessRights FullAccess `
      -InheritanceType All `
      -AutoMapping $true | Out-Null
    Write-Ok "Full Access granted, mailbox will auto-map in Outlook"
  }

  # Send As — replies come from the operator address rather than from a person.
  # Separate from Full Access on purpose: reading and speaking as are different
  # permissions, and Exchange grants them separately.
  $hasSendAs = Get-RecipientPermission -Identity $MailboxAddress -Trustee $delegate -ErrorAction SilentlyContinue |
    Where-Object { $_.AccessRights -contains 'SendAs' -and $_.AccessControlType -eq 'Allow' }

  if ($hasSendAs) {
    Write-Skip "Send As already granted"
  } elseif ($WhatIfOnly) {
    Write-Skip "Would grant Send As"
  } else {
    Add-RecipientPermission -Identity $MailboxAddress `
      -Trustee $delegate `
      -AccessRights SendAs `
      -Confirm:$false | Out-Null
    Write-Ok "Send As granted"
  }
}

# ---------------------------------------------------------------------------
# What it looks like afterwards
# ---------------------------------------------------------------------------

if ($WhatIfOnly) {
  Write-Step "Nothing was changed (-WhatIfOnly)"
  return
}

Write-Step "Result"
Get-Mailbox -Identity $MailboxAddress |
  Select-Object DisplayName, PrimarySmtpAddress, RecipientTypeDetails, MessageCopyForSentAsEnabled |
  Format-List

Write-Host "Full Access:" -ForegroundColor Cyan
Get-MailboxPermission -Identity $MailboxAddress |
  Where-Object { $_.User -notlike 'NT AUTHORITY\*' -and -not $_.Deny } |
  Select-Object User, AccessRights |
  Format-Table -AutoSize

Write-Host "Send As:" -ForegroundColor Cyan
Get-RecipientPermission -Identity $MailboxAddress |
  Where-Object { $_.Trustee -notlike 'NT AUTHORITY\*' } |
  Select-Object Trustee, AccessRights |
  Format-Table -AutoSize

Write-Host @"

After this script
-----------------
Delegation is mail access. It is not Aegis ID access, and the two are separate
on purpose.

1. Register an Aegis ID account for $MailboxAddress.
   The verification code is emailed, and a delegate with Full Access can read
   it in the shared mailbox. Without this account nobody can sign in as the
   operator and /admin is unreachable for everybody.

2. Confirm PLATFORM_OPERATOR_EMAILS names this address in .env, .env.dev and
   .env.qa, then deploy. The deploy script forwards it as an app setting.

3. Check the startup log. It prints either
     "Platform administration is restricted to PLATFORM_OPERATOR_EMAILS."
   or a warning naming the account it has grandfathered instead — which means
   the setting did not reach the App Service.

Adding or removing an operator later is this script with another
-DelegateAddress, plus the address in PLATFORM_OPERATOR_EMAILS.
"@ -ForegroundColor Yellow
