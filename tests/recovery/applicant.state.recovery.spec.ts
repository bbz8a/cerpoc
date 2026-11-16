import { test } from '@playwright/test';
import { ApplicantUser } from '../../pages';
import { getAccountPair } from '../../utils/accounts';
import { signInAs, signOut, startSession } from '../../utils/session';
import { approveApplication } from '../../flows/participant.flow';

/**
 * RECOVERY (not business-as-usual): returns the applicant account to a clean
 * state after a failed run left an undesirable intermediate state, so the BAU
 * suite can run. The app allows only ONE open application per account.
 *
 *   - Submitted application awaiting assessment -> CER admin approves it
 *   - Draft held                                -> withdrawn via the role switch
 *                                                  ("Begin a new application (withdraws ...)")
 *   - Nothing held                              -> nothing to do
 *
 *   applicant account -> E2E_APPLICANT (default: officer)
 *   approver account  -> E2E_APPROVER  (default: admin)
 */

const [applicant, approver] = getAccountPair(process.env.E2E_APPLICANT ?? 'officer', process.env.E2E_APPROVER ?? 'admin');

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test('Recover applicant account: no open application', async ({ page }) => {
  const notes = test.info().annotations;
  const user = new ApplicantUser(page);
  await startSession(page);
  await signInAs(page, applicant);

  // Withdraw any held draft when the role switch offers the choice
  await user.base.ensureRole('applicant', undefined, 'new');
  let held = await user.application.readCurrentApplication();

  // Already in the applicant role (no dialog shown) with a draft: force the switch to withdraw it
  if (held && !held.pending) {
    notes.push({ type: 'recovery', description: `withdrawing draft ${held.legalName}` });
    await user.base.ensureRole('applicant', undefined, 'new', true);
    held = await user.application.readCurrentApplication();
  }

  if (held?.pending) {
    notes.push({ type: 'recovery', description: `approving outstanding ${held.legalName}` });
    await approveApplication(page, approver, held.legalName);
    await signInAs(page, applicant);
    await user.base.ensureRole('applicant', undefined, 'new');
    held = await user.application.readCurrentApplication();
  }

  if (held) throw new Error(`Applicant still holds ${held.legalName} after recovery`);
  notes.push({ type: 'recovery', description: 'applicant account holds no open application' });
  await signOut(page);
});
