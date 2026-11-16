import { Page, expect, test } from '@playwright/test';
import { ApplicantUser, CerUser } from '../pages';
import { Account } from '../utils/accounts';
import { signInAs } from '../utils/session';
import { record, approvedParticipants, CachedParticipant } from '../utils/ledger';
import { abnFromLegalName, buildOrganisation, orgPrefix, typeFromLegalName } from '../dynamic.data/organisation.builder';
import { OrganisationDetails, ParticipantType } from '../types/organisation';

/**
 * Participant application business flows. All run in ONE page: users take turns
 * by signing out and in, so a scenario is a single video.
 */

/** CER admin approves an application located by ABN; the type is checked on the row. */
export async function approveApplication(page: Page, approver: Account, legalName: string) {
  const cer = new CerUser(page);
  const abn = abnFromLegalName(legalName);
  const type = typeFromLegalName(legalName) ?? undefined;
  await test.step(`CER admin approves application ${legalName}`, async () => {
    await signInAs(page, approver);
    await cer.base.ensureRole('cer_admin');
    await cer.workbench.openParticipants();
    await cer.register.openApplicationsQueue();
    await cer.queue.openApplication(abn, type);

    await cer.review.expectLoaded();
    const ids = await cer.review.readIdentifiers();
    expect(ids.legalName).toBe(legalName);
    await cer.review.addAssessmentNote(
      `Name: ${ids.legalName}\nAddress: ${ids.address}\nApplication ID: ${ids.applicationId}\nParticipant ID: ${ids.participantId}`
    );
    await cer.review.decide('Approve', 'This an automated approval by Playwright');

    await cer.workbench.openParticipants();
    await cer.register.expectStatus(abn, 'approved', type);
  });
  record({ event: 'application.approved', abn, legalName, type, status: 'approved' });
}

/**
 * Positive flow: applicant creates and submits an application of the given type,
 * CER admin approves it. The applicant account must hold no open application -
 * otherwise run the recovery suite (.\run-e2e.ps1 -Scenario recovery).
 */
export async function createAndApproveParticipant(
  page: Page, type: ParticipantType, applicant: Account, approver: Account,
): Promise<OrganisationDetails> {
  const user = new ApplicantUser(page);
  const app = user.application;
  const org = buildOrganisation(type);
  test.info().annotations.push({ type: 'new application', description: `${org.legal_name} (${type})` });

  await test.step(`Applicant creates and submits ${type} application`, async () => {
    await signInAs(page, applicant);
    await user.base.ensureRole('applicant');
    const held = await app.readCurrentApplication();
    if (held) {
      throw new Error(`Applicant account "${applicant.key}" already holds ${held.legalName} ` +
        `(${held.pending ? 'awaiting assessment' : 'draft'}) - run the recovery suite: .\\run-e2e.ps1 -Scenario recovery`);
    }
    await app.openForm();
    await app.fillOrganisation(org);
    await app.confirmDeclarations();
    await app.addEvidence(`Test evidence optional notes Automated for: ${org.legal_name}`);
    if (!(await app.submitToCer(org.legal_name))) {
      throw new Error(`Submit rejected for ${org.legal_name} - see 'issue' annotation`);
    }
  });
  record({ event: 'application.created', abn: org.abn, legalName: org.legal_name, type, status: 'submitted', participantStatus: 'pending' });

  await approveApplication(page, approver, org.legal_name);
  return org;
}

/**
 * An approved participant of the given type, in order of preference:
 *   1. latest from the local cache (data/cache/<host>.ledger.json)
 *   2. first approved "AUTO-<TYPE> Legal <ABN>" in the participant register (type checked)
 *   3. created and approved now
 */
export async function ensureApprovedParticipant(
  page: Page, type: ParticipantType, applicant: Account, approver: Account,
): Promise<CachedParticipant> {
  const notes = test.info().annotations;
  const cached = approvedParticipants(type)[0];
  if (cached) {
    notes.push({ type: 'participant (from cache)', description: `${cached.legalName} (${type})` });
    return cached;
  }

  const found = await test.step(`Find an approved ${orgPrefix(type)} participant in the register`, async () => {
    const cer = new CerUser(page);
    await signInAs(page, approver);
    await cer.base.ensureRole('cer_admin');
    await cer.workbench.openParticipants();
    await cer.register.searchFor(`${orgPrefix(type)} Legal`, 'approved');
    const row = cer.register.rows.filter({ has: page.getByRole('cell', { name: type, exact: true }) }).first();
    if (!(await row.isVisible())) return null;
    const legalName = (await row.getByRole('cell').first().getByRole('link').innerText()).trim();
    return { abn: abnFromLegalName(legalName), legalName, type, approvedAt: '' };
  });
  if (found) {
    notes.push({ type: 'participant (from register)', description: `${found.legalName} (${type})` });
    return found;
  }

  const org = await createAndApproveParticipant(page, type, applicant, approver);
  return { abn: org.abn, legalName: org.legal_name, type, approvedAt: new Date().toISOString() };
}
