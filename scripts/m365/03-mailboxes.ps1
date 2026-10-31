#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Step 3 of 5. Creates this environment's shared mailboxes on M365_DOMAIN: the no-reply sender
  (GRAPH_SENDER) and, when EMAIL_HELP is set, the help inbox. Grants the owners access.

.DESCRIPTION
  Who runs it: an Exchange admin of the tenant. Connect-ExchangeOnline opens a browser to sign
  in. An agent may run it with -DryRun only.

  Shared mailboxes need no licence (under 50 GB) and have no password: nobody signs in to them.
  People open them through Full Access; the app reaches them through its app registration.

  No-reply (GRAPH_SENDER)
    - Created as a shared mailbox named M365_DISPLAY_NAME. Recipients see this name.
    - Owners get Full Access, to read bounces and the replies people send anyway.
    - M365_DMARC_RUA, when it is an address on M365_DOMAIN, is added as an extra address on it,
      so DMARC reports have somewhere to land without another mailbox.
  Help inbox (EMAIL_HELP)
    - Accepts mail from outside the organisation (Gmail and so on).
    - Owners get Full Access and Send As, so they reply as help@ from Outlook, and copies of
      what they send are kept in the shared mailbox's Sent Items, not in their own.

  Reads: M365_DOMAIN, M365_APP_SLUG, GRAPH_SENDER, EMAIL_HELP, EMAIL_FROM, M365_DISPLAY_NAME,
  M365_MAILBOX_OWNERS (comma-separated; defaults to M365_ADMIN_UPN), M365_DMARC_RUA.

  Idempotent: re-running skips what exists and re-applies settings and permissions. A mailbox
  made a moment ago may not be found by the permission commands yet; wait 10 to 15 minutes and
  run it again.

.EXAMPLE
  pwsh scripts/m365/03-mailboxes.ps1 -Env dev
#>
param(
  [Parameter(Mandatory)][Alias('Env')][string]$Environment,
  [switch]$DryRun
)
. "$PSScriptRoot/lib/M365Env.ps1"
$c = Import-M365Env $Environment
Write-M365Plan $c
if (-not $c.Owners.Count) { Write-Warning 'No mailbox owners: nobody will be able to open these mailboxes in Outlook. Set M365_MAILBOX_OWNERS.' }

$helpName = if ($c.DisplayName -match '(?i)help$') { $c.DisplayName } else { "$($c.DisplayName) Help" }
$mailboxes = @(
  @{ Address = $c.Sender; Alias = ($c.Sender -split '@')[0]; Name = "$($c.DisplayName) ($($c.Sender))"; Display = $c.DisplayName; Help = $false }
)
if ($c.Help) {
  $mailboxes += @{ Address = $c.Help; Alias = ($c.Help -split '@')[0]; Name = "$helpName ($($c.Help))"; Display = $helpName; Help = $true }
}

if ($DryRun) {
  Write-Host '==> Dry run. Would create or update:' -ForegroundColor Cyan
  foreach ($m in $mailboxes) { "    shared mailbox {0}  shown as `"{1}`"{2}" -f $m.Address, $m.Display, $(if ($m.Help) { '  (accepts external mail; owners get Send As)' } else { '' }) }
  if ($c.DmarcRua) { "    extra address $($c.DmarcRua) on $($c.Sender)" }
  return
}

Connect-M365Exchange $c
if (-not (Get-AcceptedDomain | Where-Object { $_.DomainName -eq $c.Domain })) {
  throw "$($c.Domain) is not a domain on this tenant. Run 01-check-domain.ps1 first."
}

foreach ($m in $mailboxes) {
  $existing = Get-EXOMailbox -Identity $m.Address -ErrorAction SilentlyContinue
  if ($existing -and $existing.RecipientTypeDetails -ne 'SharedMailbox') {
    throw "$($m.Address) already exists as a $($existing.RecipientTypeDetails), not a shared mailbox. Pick another address or convert it in the admin centre."
  }
  if (-not $existing) {
    New-Mailbox -Shared -Name $m.Name -DisplayName $m.Display -Alias $m.Alias -PrimarySmtpAddress $m.Address | Out-Null
    Write-Host "==> Created shared mailbox $($m.Address)" -ForegroundColor Green
  } else {
    Write-Host "==> $($m.Address) already exists"
  }

  if ($m.Help) {
    Set-Mailbox -Identity $m.Address -RequireSenderAuthenticationEnabled $false `
      -MessageCopyForSentAsEnabled $true -MessageCopyForSendOnBehalfEnabled $true
  }
  foreach ($o in $c.Owners) {
    Add-MailboxPermission -Identity $m.Address -User $o -AccessRights FullAccess -InheritanceType All -AutoMapping $true -ErrorAction SilentlyContinue | Out-Null
    if ($m.Help) { Add-RecipientPermission -Identity $m.Address -Trustee $o -AccessRights SendAs -Confirm:$false -ErrorAction SilentlyContinue | Out-Null }
  }
}

if ($c.DmarcRua -and (Get-DomainOf $c.DmarcRua) -eq $c.Domain) {
  $taken = Get-EXORecipient -Identity $c.DmarcRua -ErrorAction SilentlyContinue
  if (-not $taken) {
    Set-Mailbox -Identity $c.Sender -EmailAddresses @{ Add = "smtp:$($c.DmarcRua)" }
    Write-Host "==> $($c.DmarcRua) now delivers to $($c.Sender)"
  }
}

Write-Host "`n==> Result" -ForegroundColor Cyan
foreach ($m in $mailboxes) {
  Get-EXOMailbox -Identity $m.Address -Properties EmailAddresses | Format-List DisplayName, PrimarySmtpAddress, RecipientTypeDetails, EmailAddresses
  Get-MailboxPermission -Identity $m.Address | Where-Object { $_.User -notmatch 'NT AUTHORITY' } | Format-Table User, AccessRights -AutoSize
}
Write-Host "If a permission above is missing, the mailbox is still replicating: run this again in 10 to 15 minutes."
Write-Host "Next: pwsh scripts/m365/04-restrict-app.ps1 -Env $Environment"
