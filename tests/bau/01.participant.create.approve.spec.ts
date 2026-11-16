import { test } from '@playwright/test';
import { getAccountPair } from '../../utils/accounts';
import { signOut, startSession } from '../../utils/session';
import { createAndApproveParticipant } from '../../flows/participant.flow';
import { ParticipantType } from '../../types/organisation';

/**
 * BAU positive flow - one test per participant type:
 *   applicant creates and submits an application -> CER admin approves it.
 * Legal name "AUTO-<TYPE> Legal <ABN>"; records are found by ABN and the type checked.
 * Successful transactions are recorded in data/cache/<host>.ledger.json.
 *
 *   applicant account -> E2E_APPLICANT (default: officer = outlook account)
 *   approver account  -> E2E_APPROVER  (default: admin   = indigitise account)
 *   participant types -> E2E_TYPES     (default: all)
 *
 * Precondition: the applicant account holds no open application. If a previous
 * failure left one, run the recovery suite (.\run-e2e.ps1 -Scenario recovery).
 */

const ALL_TYPES: ParticipantType[] = ['manufacturer', 'importer', 'installer', 'retailer', 'aggregator'];
const TYPES = process.env.E2E_TYPES ? (process.env.E2E_TYPES.split(',').map(t => t.trim()) as ParticipantType[]) : ALL_TYPES;
for (const t of TYPES) if (!ALL_TYPES.includes(t)) throw new Error(`Unknown participant type "${t}" in E2E_TYPES`);

const [applicant, approver] = getAccountPair(process.env.E2E_APPLICANT ?? 'officer', process.env.E2E_APPROVER ?? 'admin');

// serial: accounts share server-side role state; 3 min: several sign-ins per test
test.describe.configure({ mode: 'serial', timeout: 180_000 });

for (const type of TYPES) {
  test(`Participant ${type}: create and approve`, async ({ page }) => {
    test.info().annotations.push({ type: 'accounts', description: `applicant=${applicant.key}, approver=${approver.key}` });
    await startSession(page);
    await createAndApproveParticipant(page, type, applicant, approver);
    await signOut(page);
  });
}
