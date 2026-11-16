<#
.SYNOPSIS
  Runs the CER POC end-to-end suites against BASE_URL (from .env).

.DESCRIPTION
  Suites (Playwright projects):
    bau       business-as-usual positive flows (tests\bau)
                participants : each participant type created and approved
                devices      : device models registered by each participant type and approved for use
                phase2       : Phase 2 walkthrough - rule sets, rejected submissions, model/unit/installation (seed accounts)
                phase3       : Phase 3 walkthrough - device history, as-of reconstruction, corrections, transfer (seed accounts)
                phase4       : Phase 4 walkthrough - participant users, My account, incidents, tenant isolation (seed accounts)
                phase5       : Phase 5 walkthrough - information exchange: catalogue, outbox, reconciliation (seed accounts);
                               fault injection runs only with MOCK_PARTNERS_URL + PARTNER_API_KEY in .env
                phase6       : Phase 6 walkthrough - recalls, affected units, unit resolution, model withdrawal (seed accounts)
    api       API tests against <BASE_URL>/api, no browser (testspi)
                apisweep     : every significant API call of Phases 1-6 run once and classified against
                               /cer/api-information (SUCCESS / FAILURE / DOES NOT EXIST / PARAMETER MISMATCH /
                               NOT RUN / NOT TESTABLE). Table: data\cache\<host>.api-results.md
                               -Skip Exchange,Mail  report those calls as NOT RUN (flaky areas)
                               -Phases 2,3          run only these phases
    recovery  restores the applicant account to a clean state after a failed run (tests\recovery)

  Each test runs in ONE browser page; users take turns by signing out and in,
  so every test produces a single video (test-results\<test>\video.webm).
  Tests run one at a time because accounts share server-side role state.
  Successful transactions are recorded in data\cache\<host>.ledger.json.

  Account keys (any account can act in any role):
    admin     = CER_ADMIN_*             (indigitise)
    officer   = CER_OFFICER_*           (outlook)
    applicant = APPLICANT_PARTICIPANT_* (third account)

.EXAMPLE
  .\run-e2e.ps1                                       # all BAU tests
.EXAMPLE
  .\run-e2e.ps1 -Scenario participants -Types installer,retailer
.EXAMPLE
  .\run-e2e.ps1 -Scenario devices -Report
.EXAMPLE
  .\run-e2e.ps1 -Scenario recovery                    # after a failed run left an open application
.EXAMPLE
  .\run-e2e.ps1 -Scenario cache                       # summarise the local transaction cache
#>
param(
  [ValidateSet('bau', 'participants', 'devices', 'phase2', 'phase3', 'phase4', 'phase5', 'phase6', 'api', 'apisweep', 'recovery', 'cache')]
  [string]$Scenario = 'bau',

  # Participant types for the participants scenario (default: all five)
  [ValidateSet('manufacturer', 'importer', 'installer', 'retailer', 'aggregator')]
  [string[]]$Types,

  [ValidateSet('admin', 'officer', 'applicant')] [string]$Applicant = 'officer',   # applies
  [ValidateSet('admin', 'officer', 'applicant')] [string]$Participant = 'officer', # registers devices
  [ValidateSet('admin', 'officer', 'applicant')] [string]$Approver = 'admin',      # cer_admin approver

  # apisweep: areas to report as NOT RUN, and phases to run (default all)
  [ValidateSet('Exchange', 'Mail')] [string[]]$Skip,
  [ValidateRange(1, 6)] [int[]]$Phases,

  [switch]$Headless, # run without a browser window (videos are still recorded)
  [switch]$Report    # open the HTML report afterwards
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Scenario -eq 'cache') { node scripts/ledger-report.js; exit $LASTEXITCODE }

$pwArgs = switch ($Scenario) {
  'participants' { @('--project=bau', 'tests/bau/01.participant.create.approve.spec.ts') }
  'devices'      { @('--project=bau', 'tests/bau/02.device.model.create.approve.spec.ts') }
  'phase2'       { @('--project=bau', 'tests/bau/03.phase2.device.registration.spec.ts') }
  'phase3'       { @('--project=bau', 'tests/bau/04.phase3.device.history.spec.ts') }
  'phase4'       { @('--project=bau', 'tests/bau/05.phase4.self.service.spec.ts') }
  'phase5'       { @('--project=bau', 'tests/bau/06.phase5.information.exchange.spec.ts') }
  'phase6'       { @('--project=bau', 'tests/bau/07.phase6.recalls.spec.ts') }
  'api'          { @('--project=api') }
  'apisweep'     { @('--project=api', 'tests/api/catalogue/api-sweep.spec.ts') }
  'recovery'     { @('--project=recovery') }
  default        { @('--project=bau') }
}

$env:E2E_APPLICANT   = $Applicant
$env:E2E_PARTICIPANT = $Participant
$env:E2E_APPROVER    = $Approver
$env:E2E_TYPES       = if ($Types) { $Types -join ',' } else { $null }
$env:HEADLESS        = if ($Headless) { '1' } else { $null }
$env:API_SKIP        = if ($Skip) { ($Skip -join ',').ToLower() } else { $null }
$env:API_PHASES      = if ($Phases) { $Phases -join ',' } else { $null }

Write-Host "Scenario : $Scenario"
Write-Host "Accounts : applicant=$Applicant participant=$Participant approver=$Approver"
Write-Host "Browser  : $(if ($Headless) { 'headless' } else { 'headed' })"
if ($Types) { Write-Host "Types    : $($Types -join ', ')" }
if ($Skip) { Write-Host "Skip     : $($Skip -join ', ') (reported as NOT RUN)" }
if ($Phases) { Write-Host "Phases   : $($Phases -join ', ')" }
Write-Host ''

npx playwright test @pwArgs --workers=1 --reporter=list,html
$code = $LASTEXITCODE

Write-Host ''
Write-Host "Videos and failure screenshots: test-results\"
Write-Host "Accounts, records created, issues: 'Annotations' on each test in the HTML report"
Write-Host "Transaction cache summary: .\run-e2e.ps1 -Scenario cache"
if ($code -ne 0 -and $Scenario -ne 'recovery') {
  Write-Host "If a test left an open application, run: .\run-e2e.ps1 -Scenario recovery" -ForegroundColor Yellow
}
if ($Scenario -eq 'apisweep') { Write-Host "API sweep table: data\cache\$(([uri](Get-Content .env | Select-String '^BASE_URL=').Line.Split('=',2)[1]).Host).api-results.md" }
if ($Report) { npx playwright show-report }

'E2E_APPLICANT', 'E2E_PARTICIPANT', 'E2E_APPROVER', 'E2E_TYPES', 'HEADLESS', 'API_SKIP', 'API_PHASES' |
  ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }

exit $code
