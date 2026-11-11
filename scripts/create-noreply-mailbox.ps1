<#
.SYNOPSIS
  Creates the Aegis ID outbound-only sender in Exchange Online and blocks
  everything addressed back to it.

.DESCRIPTION
  Every message the platform sends — sign-in codes, password reset links,
  wallet recovery codes, root wallet approval requests — goes out through one
  address. This script creates it and makes it genuinely one-way:

    * a shared mailbox, so it needs no licence and has no interactive sign-in
    * hidden from the address list, so nobody picks it out of the GAL and
      writes to it by accident
    * a mail flow rule that rejects anything addressed to it, with an NDR that
      says where to write instead

  The rejection is a transport rule rather than `AcceptMessagesOnlyFrom`,
  because the sender gets a bounce that explains itself. Silently dropping a
  reply from somebody who did not notice the address is how a support request
  disappears.

  It is deliberately separate from the operator mailbox: the operator address
  is read by a person, and this one is never read at all.

  Idempotent. Run it again and it reports what already exists.

.PARAMETER MailboxAddress
  The sending address. Must match SMTP_FROM_ADDRESS in the environment files.

.PARAMETER ReplyToAddress
  The address the bounce points people at — the operator mailbox.

.PARAMETER SendAsAddress
  Who may send as this address, repeatable. Only needed for the Graph route
  below, where a delegate is useful for testing by hand; the SMTP route
  authenticates as the mailbox itself.

.PARAMETER DisplayName
  What recipients see in the From line.

.PARAMETER WhatIfOnly
  Report what would change and make no change.

.EXAMPLE
  pwsh ./scripts/create-noreply-mailbox.ps1 `
    -MailboxAddress no-reply-aegis-id@vanguardcs.ca `
    -ReplyToAddress help-aegis-id@vanguardcs.ca

.NOTES
  Needs the ExchangeOnlineManagement module and the Exchange Administrator
  role.

      Install-Module ExchangeOnlineManagement -Scope CurrentUser

  Creating the mailbox is not the same as being able to send through it. Read
  "After this script" at the end — a shared mailbox cannot authenticate to
  SMTP on its own.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $MailboxAddress,

  [Parameter(Mandatory = $true)]
  [string] $ReplyToAddress,

  [string[]] $SendAsAddress = @(),

  [string] $DisplayName = 'Aegis ID (no reply)',

  [string] $Alias,

  [string] $RuleName = 'Aegis ID no-reply - reject inbound',

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

Write-Step "Checking the reply-to address $ReplyToAddress"
if (-not (Get-Recipient -Identity $ReplyToAddress -ErrorAction SilentlyContinue)) {
  throw "$ReplyToAddress is not a recipient in this tenant. The bounce would point people at an address that does not exist."
}
Write-Ok "Exists"

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

  # Exchange takes a moment to make a new mailbox addressable; anything applied
  # immediately afterwards fails with "object couldn't be found".
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

# Out of the address list, and no copy kept of what it sends. A send-only
# identity accumulating a Sent Items folder is storage nobody will ever read,
# and the platform already keeps its own delivery log at /admin/notifications.
if (-not $WhatIfOnly -and $mailbox) {
  Set-Mailbox -Identity $MailboxAddress `
    -HiddenFromAddressListsEnabled $true `
    -MessageCopyForSentAsEnabled $false `
    -MessageCopyForSendOnBehalfEnabled $false
  Write-Ok "Hidden from the address list"
} elseif ($WhatIfOnly) {
  Write-Skip "Would hide it from the address list and keep no sent copies"
}

# ---------------------------------------------------------------------------
# Outbound only
# ---------------------------------------------------------------------------

Write-Step "Mail flow rule '$RuleName'"
$rule = Get-TransportRule -Identity $RuleName -ErrorAction SilentlyContinue

$rejectText = "This address does not receive mail. Aegis ID sends from it and nobody reads it. Write to $ReplyToAddress instead."

if ($WhatIfOnly) {
  if ($rule) {
    Write-Skip "Would update the existing rule to reject mail to $MailboxAddress"
  } else {
    Write-Skip "Would create a rule rejecting mail to $MailboxAddress with: $rejectText"
  }
} elseif ($rule) {
  Set-TransportRule -Identity $RuleName `
    -SentTo $MailboxAddress `
    -RejectMessageEnhancedStatusCode '5.7.1' `
    -RejectMessageReasonText $rejectText
  Write-Ok "Rule updated"
} else {
  New-TransportRule -Name $RuleName `
    -SentTo $MailboxAddress `
    -RejectMessageEnhancedStatusCode '5.7.1' `
    -RejectMessageReasonText $rejectText `
    -Comments 'Created by scripts/create-noreply-mailbox.ps1 in the aegis-id repository. The address is the platform sender for sign-in codes, reset links and recovery codes; it is outbound only.' `
    -Mode Enforce | Out-Null
  Write-Ok "Rule created — anything sent to $MailboxAddress is bounced"
}

# ---------------------------------------------------------------------------
# Send As
# ---------------------------------------------------------------------------

foreach ($trustee in $SendAsAddress) {
  Write-Step "Send As for $trustee"

  if (-not (Get-Recipient -Identity $trustee -ErrorAction SilentlyContinue)) {
    throw "$trustee is not a recipient in this tenant. Check the address."
  }

  $hasSendAs = Get-RecipientPermission -Identity $MailboxAddress -Trustee $trustee -ErrorAction SilentlyContinue |
    Where-Object { $_.AccessRights -contains 'SendAs' -and $_.AccessControlType -eq 'Allow' }

  if ($hasSendAs) {
    Write-Skip "Already granted"
  } elseif ($WhatIfOnly) {
    Write-Skip "Would grant Send As"
  } else {
    Add-RecipientPermission -Identity $MailboxAddress `
      -Trustee $trustee `
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
  Select-Object DisplayName, PrimarySmtpAddress, RecipientTypeDetails, HiddenFromAddressListsEnabled |
  Format-List

Get-TransportRule -Identity $RuleName |
  Select-Object Name, State, Mode, SentTo, RejectMessageReasonText |
  Format-List

Write-Host @"

After this script
-----------------
The address exists and is one-way. It cannot send yet, and that is the part
that needs a decision rather than a command.

A shared mailbox has no licence and therefore cannot authenticate to SMTP.
Exchange Online refuses SMTP AUTH for an unlicensed mailbox whatever the
password is, so pointing SMTP_USERNAME at $MailboxAddress will fail
with 535 5.7.139. There are two ways on from here.

  1. Licence it and use SMTP.
     Assign an Exchange Online Plan 1 (or any M365 Business) licence to
     $MailboxAddress, then:

       Set-CASMailbox -Identity $MailboxAddress -SmtpClientAuthenticationDisabled `$false

     and confirm the tenant default is not blocking it:

       Get-TransportConfig | Select-Object SmtpClientAuthenticationDisabled

     Then set, in .env.local for localhost and in .env / .env.dev / .env.qa
     for the hosted environments:

       SMTP_HOST=smtp.office365.com
       SMTP_PORT=587
       SMTP_SECURE=false
       SMTP_REQUIRE_TLS=true
       SMTP_USERNAME=$MailboxAddress
       SMTP_PASSWORD=<the account password or an app password>
       SMTP_FROM_ADDRESS=$MailboxAddress

     No code change — src/adapters/notify/notification-adapter.js already
     sends over SMTP, and src/services/notification-settings-service.js lets
     SMTP_HOST plus SMTP_FROM_ADDRESS override the filesystem preset, so
     localhost starts sending real mail the moment those are set.

     The cost of this route is a licence, a password in the environment, and a
     Conditional Access exclusion if MFA is enforced. Microsoft is also
     retiring SMTP AUTH client submission, so treat it as the route that works
     today rather than the one to build on.

  2. Send through Microsoft Graph instead.
     No licence, no password, and not deprecated. Register an application,
     grant it the Mail.Send *application* permission, and scope it to this one
     mailbox so it cannot send as anybody else:

       New-ApplicationAccessPolicy ``
         -AppId <application id> ``
         -PolicyScopeGroupId $MailboxAddress ``
         -AccessRight RestrictAccess ``
         -Description 'Aegis ID platform sender'

     This one needs a Graph transport added beside the SMTP one in
     src/adapters/notify/notification-adapter.js. Ask for it and it is a
     contained change — the adapter already chooses by preset.

Either way, the address to put in SMTP_FROM_ADDRESS is $MailboxAddress, and
anything a recipient sends back to it now bounces to $ReplyToAddress.
"@ -ForegroundColor Yellow
