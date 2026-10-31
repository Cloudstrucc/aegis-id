#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Step 1 of 5. Checks that M365_DOMAIN is a verified domain on the Microsoft 365 tenant and
  prints the DNS records mail from it needs (MX, SPF, autodiscover, DKIM, DMARC), with what DNS
  answers today. Read-only unless you pass -EnableDkim.

.DESCRIPTION
  Who runs it: a person who is an Exchange admin on the tenant. Connect-ExchangeOnline opens a
  browser to sign in. An agent may run it with -DryRun only (no sign-in, no changes).

  Reads from the env file (see scripts/m365/README.md for every key):
    M365_DOMAIN       the domain the mailboxes live on, e.g. vanguardcs.ca or cloudstrucc.com
    M365_APP_SLUG     short name for this app, e.g. aegis
    M365_ADMIN_UPN    optional: the admin account to sign in as
    M365_DMARC_RUA    optional: where DMARC reports go, e.g. dmarc@vanguardcs.ca

  Adding a domain to the tenant is not scripted: it needs a TXT record only the admin centre
  can issue. Do it at admin.microsoft.com > Settings > Domains > Add domain, then run this.

  DKIM: the first run creates the domain's DKIM keys (disabled) so the two CNAMEs can be shown.
  Publish them at the DNS host, wait for them to resolve, then run again with -EnableDkim.

.EXAMPLE
  pwsh scripts/m365/01-check-domain.ps1 -Env dev
.EXAMPLE
  pwsh scripts/m365/01-check-domain.ps1 -Env prod -EnableDkim
.EXAMPLE
  pwsh scripts/m365/01-check-domain.ps1 -Env dev -DryRun
#>
param(
  [Parameter(Mandatory)][Alias('Env')][string]$Environment,
  [switch]$EnableDkim,
  [switch]$DryRun
)
. "$PSScriptRoot/lib/M365Env.ps1"
$c = Import-M365Env $Environment
Write-M365Plan $c
$d = $c.Domain

# What DNS says today, via dig (Resolve-DnsName exists only on Windows).
function Get-Dns([string]$Type, [string]$Name) {
  if (-not (Get-Command dig -ErrorAction SilentlyContinue)) { return '(dig not installed)' }
  $out = @(& dig +short $Type $Name 2>$null | Where-Object { $_ })
  if ($out.Count) { return ($out -join ' | ') } else { return '(nothing)' }
}

if ($DryRun) {
  Write-Host '==> Dry run: not signing in. DNS as it stands:' -ForegroundColor Cyan
  "    MX     $d  ->  $(Get-Dns MX $d)"
  "    TXT    $d  ->  $(Get-Dns TXT $d)"
  "    TXT    _dmarc.$d  ->  $(Get-Dns TXT "_dmarc.$d")"
  return
}

Connect-M365Exchange $c

$accepted = Get-AcceptedDomain | Where-Object { $_.DomainName -eq $d }
if (-not $accepted) {
  throw "$d is not a domain on this tenant yet. Add and verify it at admin.microsoft.com > Settings > Domains > Add domain, then run this again."
}
Write-Host "==> $d is an accepted domain ($($accepted.DomainType))" -ForegroundColor Green

# DKIM keys: create them (disabled) if the domain has none, so the CNAMEs exist to publish.
$dkim = Get-DkimSigningConfig -Identity $d -ErrorAction SilentlyContinue
if (-not $dkim) {
  Write-Host "==> Creating DKIM keys for $d (left disabled until the CNAMEs resolve)" -ForegroundColor Cyan
  $dkim = New-DkimSigningConfig -DomainName $d -Enabled $false
}

# The MX target is shown in admin.microsoft.com > Settings > Domains > $d > DNS records. Newer
# tenants get "<domain>.<x>.mx.microsoft"; the long-standing form is below. Use what the admin
# centre shows when the two differ.
$mxGuess = ($d -replace '\.', '-') + '.mail.protection.outlook.com'
$rua = if ($c.DmarcRua) { $c.DmarcRua } else { "dmarc@$d" }

Write-Host "`n==> DNS records for $d (type, host, value) and what resolves now" -ForegroundColor Cyan
@(
  [pscustomobject]@{ Type = 'MX'; Host = '@'; Value = "$mxGuess (priority 0)"; Now = (Get-Dns MX $d) }
  [pscustomobject]@{ Type = 'TXT'; Host = '@'; Value = 'v=spf1 include:spf.protection.outlook.com -all'; Now = (Get-Dns TXT $d) }
  [pscustomobject]@{ Type = 'CNAME'; Host = 'autodiscover'; Value = 'autodiscover.outlook.com'; Now = (Get-Dns CNAME "autodiscover.$d") }
  [pscustomobject]@{ Type = 'CNAME'; Host = 'selector1._domainkey'; Value = $dkim.Selector1CNAME; Now = (Get-Dns CNAME "selector1._domainkey.$d") }
  [pscustomobject]@{ Type = 'CNAME'; Host = 'selector2._domainkey'; Value = $dkim.Selector2CNAME; Now = (Get-Dns CNAME "selector2._domainkey.$d") }
  [pscustomobject]@{ Type = 'TXT'; Host = '_dmarc'; Value = "v=DMARC1; p=none; rua=mailto:$rua"; Now = (Get-Dns TXT "_dmarc.$d") }
) | Format-List

@'
Notes:
  - Compare each Value with Now. Where Now already holds an SPF, DMARC or MX record, keep it
    (merge an include into the one SPF record); a domain may have only one SPF and one DMARC.
  - A domain that already has mail elsewhere (Google Workspace, a forwarder) must not get the MX
    or SPF above without merging: one SPF record per domain, and MX decides who receives.
    Sending through Graph works without the MX change; bounces then go wherever MX points.
  - Start DMARC at p=none, read the reports for a few weeks, then raise it to p=quarantine.
'@ | Write-Host

if ($EnableDkim) {
  if ((Get-Dns CNAME "selector1._domainkey.$d") -eq '(nothing)') {
    throw "selector1._domainkey.$d does not resolve yet. Publish both DKIM CNAMEs, wait, then run with -EnableDkim again."
  }
  Set-DkimSigningConfig -Identity $d -Enabled $true
  Write-Host "==> DKIM enabled for $d" -ForegroundColor Green
} else {
  Write-Host "DKIM is $(if ($dkim.Enabled) { 'enabled' } else { 'disabled' }) for $d$(if (-not $dkim.Enabled) { '. Publish the two CNAMEs, then run again with -EnableDkim.' })"
}
Write-Host "`nNext: scripts/m365/02-app-registration.sh --env $Environment"
