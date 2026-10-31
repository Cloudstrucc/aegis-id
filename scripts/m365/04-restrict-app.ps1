#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Step 4 of 5. Restricts the app registration to this app's mailboxes only, then proves it:
  Granted for GRAPH_SENDER (and EMAIL_HELP), Denied for the admin running the script.

.DESCRIPTION
  Why: Mail.Send and Mail.ReadWrite as application permissions reach every mailbox in the
  tenant. Until this runs, a leaked client secret can send as, and read, anyone, including the
  people who run the tenant.

  How: an Exchange Application Access Policy (RestrictAccess) scoped to a mail-enabled security
  group whose only members are this app's mailboxes. A group, not the mailbox itself: Exchange
  rejects a shared mailbox as the scope ("not a security principal"), which is what happened on
  the Raiders setup before it was moved to a group. The group is hidden from the address book.

  An app can have several RestrictAccess policies; it may use any mailbox that one of them
  covers. So a second environment's mailbox joins the same group, and nothing else changes.

  Microsoft's newer mechanism for the same thing is "RBAC for Applications"
  (New-ManagementRoleAssignment with a management scope). Application Access Policies still
  work and are what the existing setup uses; move both together if you move.

  Who runs it: an Exchange admin. An agent may run it with -DryRun only.
  Reads: GRAPH_CLIENT_ID (written by step 2), GRAPH_SENDER, EMAIL_HELP, M365_SENDER_GROUP
  (default <slug>-mail-senders@<domain>), M365_DOMAIN, M365_APP_SLUG, M365_DISPLAY_NAME.

  Timing: a brand-new group can take 15 to 30 minutes before a policy accepts it, and a new
  policy up to an hour before sends obey it. Re-running is safe: it skips what exists and
  re-tests. A Denied for GRAPH_SENDER right after creation usually means "not applied yet".

.EXAMPLE
  pwsh scripts/m365/04-restrict-app.ps1 -Env dev
.EXAMPLE
  pwsh scripts/m365/04-restrict-app.ps1 -Env dev -TestOnly
#>
param(
  [Parameter(Mandatory)][Alias('Env')][string]$Environment,
  [switch]$TestOnly,
  [switch]$DryRun
)
. "$PSScriptRoot/lib/M365Env.ps1"
$c = Import-M365Env $Environment
Write-M365Plan $c
if (-not $c.ClientId) { throw "GRAPH_CLIENT_ID is not in $($c.EnvFile). Run 02-app-registration.sh first." }
$members = @($c.Sender) + @($c.Help | Where-Object { $_ })
$groupAlias = ($c.SenderGroup -split '@')[0]

if ($DryRun) {
  Write-Host '==> Dry run. Would:' -ForegroundColor Cyan
  "    create mail-enabled security group $($c.SenderGroup) (hidden), members: $($members -join ', ')"
  "    create Application Access Policy RestrictAccess for the app in GRAPH_CLIENT_ID, scoped to that group"
  "    test: Granted for $($members -join ', '); Denied for the signed-in admin"
  return
}

Connect-M365Exchange $c

if (-not $TestOnly) {
  if (-not (Get-DistributionGroup -Identity $c.SenderGroup -ErrorAction SilentlyContinue)) {
    New-DistributionGroup -Name "$($c.DisplayName) Mail Senders" -Alias $groupAlias -Type Security `
      -PrimarySmtpAddress $c.SenderGroup | Out-Null
    Write-Host "==> Created security group $($c.SenderGroup)" -ForegroundColor Green
    Start-Sleep -Seconds 30
  }
  # Hidden from the address book and closed to mail: it exists only to scope the policy.
  Set-DistributionGroup -Identity $c.SenderGroup -HiddenFromAddressListsEnabled $true `
    -RequireSenderAuthenticationEnabled $true -ErrorAction SilentlyContinue
  $current = @(Get-DistributionGroupMember -Identity $c.SenderGroup | ForEach-Object { "$($_.PrimarySmtpAddress)".ToLowerInvariant() })
  foreach ($m in $members) {
    if ($current -notcontains $m) {
      Add-DistributionGroupMember -Identity $c.SenderGroup -Member $m
      Write-Host "==> Added $m to the group"
    }
  }

  $group = Get-DistributionGroup -Identity $c.SenderGroup
  $policy = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue | Where-Object {
    $_.AppId -eq $c.ClientId -and $_.AccessRight -eq 'RestrictAccess' -and
    ($_.ScopeIdentity -eq $group.Identity -or $_.ScopeName -eq $group.Name -or "$($_.ScopeIdentity)" -like "*$($group.Name)*")
  }
  if ($policy) {
    Write-Host '==> The access policy for this app and group already exists'
  } else {
    try {
      New-ApplicationAccessPolicy -AppId $c.ClientId -PolicyScopeGroupId $c.SenderGroup -AccessRight RestrictAccess `
        -Description "$($c.AppName): only the mailboxes in $($c.SenderGroup)" | Out-Null
      Write-Host '==> Created the access policy' -ForegroundColor Green
    } catch {
      if ("$_" -match 'security principal|couldn.t find|not found') {
        throw "Exchange cannot use the group yet ($_). It is still replicating: run this again in 15 to 30 minutes."
      }
      throw
    }
  }
}

Write-Host "`n==> Access test (policies can take up to an hour to apply)" -ForegroundColor Cyan
$me = Get-M365SignedInUpn
$rows = foreach ($m in $members + @($me)) {
  $result = try { (Test-ApplicationAccessPolicy -Identity $m -AppId $c.ClientId).AccessCheckResult } catch { "error: $($_.Exception.Message)" }
  [pscustomobject]@{ Mailbox = $m; Result = $result; Expected = $(if ($m -eq $me) { 'Denied' } else { 'Granted' }) }
}
$rows | Format-Table -AutoSize
$wrong = @($rows | Where-Object { "$($_.Result)" -ne $_.Expected })
if ($wrong.Count) {
  Write-Warning "Not as expected yet. If the policy was just created, wait and run: pwsh scripts/m365/04-restrict-app.ps1 -Env $Environment -TestOnly"
  exit 1
}
Write-Host '==> The app can use only its own mailboxes' -ForegroundColor Green
Write-Host "Next: scripts/m365/05-send-test.sh --env $Environment --to <your address>"
