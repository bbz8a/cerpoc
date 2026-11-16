# cerpoc - Playwright tests for the CER device register POC

End-to-end (browser) and API tests for the RegiGov CER device register sandbox (`https://cerpoc.regigov.au`).

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js (LTS) | 20 or later (tested on 24) | `node -v` |
| npm | comes with Node.js | `npm -v` |
| Git | any | `git --version` |
| PowerShell | Windows PowerShell 5.1 or PowerShell 7 - for `run-e2e.ps1` | `$PSVersionTable.PSVersion` |

Install Node.js from https://nodejs.org (the LTS installer adds npm). On macOS/Linux you can skip PowerShell
and run Playwright directly (see section 4).

## 2. Install

From the `cerpoc` folder:

```powershell
npm ci                          # installs @playwright/test, dotenv, @types/node from package-lock.json
npx playwright install chromium # downloads the browser the tests use (add --with-deps on Linux)
```

Use `npm install` instead of `npm ci` if you change `package.json`.

TypeScript does not need installing: Playwright compiles the tests itself. To type-check the whole project:

```powershell
npm run typecheck
```

## 3. Configure

```powershell
Copy-Item .env.example .env     # macOS/Linux: cp .env.example .env
```

Fill in `.env`. Ask the project owner for the passwords - never commit `.env`.

| Variable | Needed for |
|---|---|
| `BASE_URL` | everything |
| `CER_ADMIN_*`, `CER_OFFICER_*`, `APPLICANT_PARTICIPANT_*` | `bau`, `participants`, `devices`, `recovery` |
| `SANDBOX_SEED_PASSWORD` | `phase2`-`phase6`, `apisweep` (seed accounts cer.admin, cer.officer, sunvolt.admin, sunvolt.user, gridcell.admin) |
| `GLOBAL_TEST_PASSWORD` | `api` (account registration tests) |
| `MOCK_PARTNERS_URL`, `PARTNER_API_KEY` | optional: Phase 5 fault injection and partner inbox calls; skipped/NOT TESTABLE without them |

If PowerShell refuses to run the script ("running scripts is disabled"), allow local scripts once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 4. Run

```powershell
.\run-e2e.ps1 -Scenario phase4 -Headless     # one walkthrough, no browser window
.\run-e2e.ps1 -Scenario apisweep -Skip Exchange,Mail
.\run-e2e.ps1 -Scenario cache                # summary of records the tests have created
Get-Help .\run-e2e.ps1 -Detailed             # every scenario and option
```

| Scenario | What it runs |
|---|---|
| `bau` (default) | all browser tests in `tests/bau` |
| `participants`, `devices` | participant create/approve, device model create/approve |
| `phase2` ... `phase6` | the phase walkthroughs (seed accounts) |
| `api` | all API tests in `tests/api` (no browser) |
| `apisweep` | each significant API call of Phases 1-6 once, classified against `/cer/api-information`; options `-Skip Exchange,Mail`, `-Phases 2,3` |
| `recovery` | puts the applicant account back after a failed run |

Useful switches: `-Headless` (no window; videos are still recorded) and `-Report` (opens the HTML report afterwards).

Without PowerShell (macOS/Linux), call Playwright directly:

```bash
HEADLESS=1 npx playwright test --project=bau tests/bau/05.phase4.self.service.spec.ts --workers=1
API_SKIP=exchange,mail npx playwright test tests/api/catalogue/api-sweep.spec.ts --workers=1
```

Always use `--workers=1`: the tests share sandbox accounts and server-side role state.

## 5. Results

| Where | What |
|---|---|
| `playwright-report/` (`npm run report`) | HTML report - per-test steps, plus 'issue', 'api' and 'record' annotations for soft failures and created data |
| `test-results/<test>/` | video of every test, screenshot and trace on failure |
| `data/cache/<host>.ledger.json` | records the tests created (`-Scenario cache` summarises it) |
| `data/cache/<host>.api-results.md` | latest API sweep table |

`data/cache/` is git-ignored: it describes one sandbox's state.

## 6. Project layout

| Folder | Contents |
|---|---|
| `tests/bau`, `tests/api`, `tests/recovery` | the specs (one Playwright project each, see `playwright.config.ts`) |
| `pages/` | page objects |
| `api/` | typed API client (`ApiClient`) and models; `api/spec/openapi.json` is a copy of `/api/docs/json` |
| `utils/` | sign-in, seed accounts, ledger, soft-issue reporting, API sweep engine |
| `data/api/api-information.json` | snapshot of `/cer/api-information`, used by the API sweep |
| `explore/` | throw-away Node scripts used to explore screens and the API (e.g. `node explore/41-api-catalogue.js` refreshes the API documentation snapshot) |
| `run-e2e.ps1` | runner with named scenarios |

## Troubleshooting

- **Login or every API call returns 502/504** (while pages still load): the sandbox API is down. The pages
  are static files, so they open even when the API is unavailable. Check with
  `curl https://cerpoc.regigov.au/api/health` and try again later.
- **`browserType.launch: Executable doesn't exist`**: run `npx playwright install chromium`.
- **`SANDBOX_SEED_PASSWORD is not set`**: fill in `.env` (section 3).
