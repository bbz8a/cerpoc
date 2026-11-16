# CER POC (cerpoc.regigov.au): test run summary, 16 Nov 2026 (23:02–23:12)

**Command:** `.\run-e2e.ps1 -Scenario bau -Headless`. No code was changed for this run.
**Detailed report:** `playwright-report\index.html` (open with `npx playwright show-report`). Each browser test has a video, plus a screenshot when it failed.

The run executed every project, not only `bau`: 37 tests in setup, bau, api and recovery.

| Result | Tests |
|---|---|
| Passed | 16 |
| Failed | 12 |
| Skipped | 9 (8 because an earlier test in the same serial file failed; 1 needs mock-partners) |

## Headline

- **6 of the 12 failures say nothing about the requirements.** The sandbox API returned **504 Gateway Time-out** during sign-in or a role switch, so those tests stopped before reaching anything under test.
- **5 failures are requirement deviations.** These are soft checks that let the test carry on, and are listed below.
- **1 failure is test data.** The registration email used is not on the allowlist.

## Hard failures: test stopped

| # | Spec / test | Stopped at | Cause | Requirement verdict |
|---|---|---|---|---|
| H1 | 01 Participant manufacturer: create and approve | Role switch to applicant | Server rejected the switch (HTTP 504) | Not tested; the 4 other participant types were skipped |
| H2 | 02 Device model: manufacturer PV module, CER approves | Banner user menu never appeared after sign-in | 504 on page load | Not tested; the 4 other device tests were skipped |
| H3 | 03 Phase 2: device registration | Sign-in (60 s, page never left /login) | 504 on `/api/auth/login` | Not tested |
| H4 | 04 Phase 3: device history | Sign-in | 504 | Not tested |
| H5 | 05 Phase 4: users (invite, password, promote/demote, disable, CER panel) | Sign-in | 504 | Not tested in this run (passed earlier, apart from the soft issues S6 and S7) |
| H6 | 07 Phase 6: batch recall | Sign-in | 504 | Not tested in this run (an earlier run reached the final Close-recall step) |
| H7 | api / auth register: registers a new user (202) | `POST /auth/register` returned **422** "Registration is not open for this email address" | The next email in `data/register.emails.json` is not on the sandbox allowlist | **Test data**, not an app fault |

## Soft failures: requirement deviations (the test ran on)

| # | Area | Requirement (walkthrough / docs) | Observed | Seen in |
|---|---|---|---|---|
| S1 | Phase 4 audit | A denied cross-tenant attempt is written to audit as `access.denied` | Denied `PATCH /participants/me/users/{id}` by gridcell.admin is **not audited** | api tenancy |
| S2 | Phase 4 audit | Same | Out-of-scope `POST /incidents` (404) by gridcell.admin is **not audited** | api tenancy; bau 05 incidents |
| S3 | Phase 4 CER users panel | cer.officer can view a participant's users (read-only) | `GET /participants/{id}/users` returns **403** for cer.officer | api tenancy (same as S7) |
| S4 | Phase 5 catalogue | The documented idempotency key matches the one in use | Catalogue says `<entityId>:<version>`; outbox uses `kind:id:versionRowId:schemaVersion` | bau 06 (the rest of test 1 passed) |
| S5 | Auth API docs | Validation errors are 422 (OpenAPI) | `POST /auth/register` validation returns **400** (short password, invalid email) | api register (both tests passed with an issue) |

**Recorded in earlier runs, not reached this time because of H5/H6:**

| # | Area | Observed |
|---|---|---|
| S6 | Phase 4 My account | Breadcrumb reads "Record account" |
| S7 | Phase 4 CER users panel | cer.officer gets 403 on a participant's Users panel in the UI |
| S8 | Phase 5 | "Publish unpublished records" returns 504 (about 1.6M records) |
| S9 | Phase 6 | `coastal.admin` from the walkthrough is not seeded; a stand-in admin was used |

## Recurring console errors (every CER page)

- **403 on `GET /api/email-test/status`** for cer.officer. The UI calls an admin-only endpoint for every CER role. cer.admin is not affected.
- **504s** whenever the backend stalls. When one happens while a page loads, the app sends the user back to the login page (seen in Phase 6), so a gateway timeout looks like an expired session.

## API sweep (same run): passed

All 16 calls on the phase lists that are on `/cer/api-information` succeed and match the documented signatures. 41 calls are **not on the API information page**, so they count as "does not exist" under the agreed definition. 40 of them do work; `GET /exchange/interfaces/{id}` has no route. Problems:

- `GET /devices/units/{id}/at` returns 504 after 20 s on every unit.
- `POST /exchange/outbox/publish-unpublished` returns 504.
- `POST /exchange/reconciliation` returns 504, but the run does start. Run 113 (network) had been "running" for well over the usual 13 minutes.

Full table: `data\cache\cerpoc.regigov.au.api-results.md`.

## Passed

| Spec / test | Note |
|---|---|
| 07 Phase 6: model-wide recall with Withdraw the model | Model withdrawn, withdrawal cited in history, new units refused, participant visibility correct, recall closed |
| api tenancy | 7 of 10 tests (isolation, admin-only users, last-admin protection, password rules, invitation validation, incident visibility, CER status flow) |
| api register | allowlist rejection; 2 validation tests (with issue S5) |
| setup (3 sign-ins) | |
| recovery | |
| api sweep | |

## Next step to get requirement verdicts

Rerun H1–H6 when the sandbox API is stable (`/api/health` answers quickly with no 504s). Until then, their failures reflect sandbox availability, not the requirements.
