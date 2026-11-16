import { Page, expect, test } from '@playwright/test';
import { IncidentPage, IncidentsPage, LoginPage, MyAccountPage, ReportIncidentPage, UsersPanel } from '../../pages';
import { SEED, SeedAccount, seedAccount, signInAsSeed } from '../../utils/seed-accounts';
import { signOut, startSession } from '../../utils/session';
import { pageApi } from '../../utils/page-api';
import { reportIssue } from '../../utils/issues';
import { record } from '../../utils/ledger';

/**
 * Phase 4 walkthrough - self-service, tenancy and participant incidents.
 *
 * Users & My account (test 1)
 *   1. sunvolt.admin  Users: invites a colleague (username, display name, role User, initial password ≥ 12).
 *                     Own row ("you") has no actions.
 *   2. colleague      Signs in; Users is admin-only (self:users). My account: a wrong current password is
 *                     refused (403, audited); changes the password and signs in with the new one.
 *   3. sunvolt.admin  Promotes the colleague to Administrator.
 *   4. colleague      As administrator: own row still has no actions and changing their own role is refused (409).
 *   5. sunvolt.admin  Demotes and disables the colleague, who can no longer sign in. sunvolt.admin cannot change
 *                     their own role.
 *   6. cer.admin      Same panel on SunVolt's participant page: last administrator's actions disabled; re-enables
 *                     and disables the colleague again (CER may manage).
 *   7. cer.officer    Same panel, read-only.
 *
 * Incidents & isolation (test 2)
 *   1. sunvolt.admin  (setup) registers a fresh SV-BAT-10 unit - GridCell is not a party to it.
 *   2. gridcell.admin Reports an incident on SVB10-24-000101 (SunVolt-owned, installed by GridCell); the fresh
 *                     SunVolt unit is 404. Sees only its own reports; adds a note.
 *                     Isolation: GET a SunVolt model it has no units of -> 404, PATCH SunVolt -> 403.
 *   3. cer.officer    Incidents & recalls: sees the reporter; skipping ahead is refused; moves the incident
 *                     open -> acknowledged -> investigating -> resolved -> closed.
 *   4. gridcell.admin Sees CER's status changes and reasons on the timeline; cannot change status.
 *   5. cer.admin      Both isolation attempts are in audit.events as access.denied.
 *
 * Each run invites its own colleague (users cannot be deleted - they are left disabled) and raises its own
 * incident (left closed). Seed accounts' roles and passwords are never changed.
 * Deviations from the walkthrough are soft failures + 'issue' annotations so the flow continues.
 */

const { sunvolt, gridcell } = SEED.participants;
const UNIT_101 = SEED.units.svb10_000101;

const stamp = Date.now().toString(36).toUpperCase();
const colleague = {
  username: `e2e.p4.${stamp.toLowerCase()}`,
  displayName: `E2E Colleague ${stamp}`,
  initialPassword: `E2e-Init-${stamp}!`,
  newPassword: `E2e-Changed-${stamp}!`,
};

test.describe.configure({ timeout: 600_000 });
test.use({ actionTimeout: 30_000 });

/** Signs in a non-seed account (the invited colleague) - same flow as the seed accounts. */
const login = (username: string, password: string): SeedAccount => ({ username, password });

/** Attempts a sign-in that must be refused: stays on /login and the API login is not 200. */
async function expectSignInRefused(page: Page, account: SeedAccount) {
  await test.step(`Sign-in refused for ${account.username}`, async () => {
    await signOut(page);
    const loginPage = new LoginPage(page);
    if (!/\/login/.test(page.url())) await page.goto(process.env.BASE_URL!, { waitUntil: 'commit' });
    await loginPage.expectLoaded();
    await loginPage.username.fill(account.username);
    await loginPage.password.fill(account.password);
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/auth/login'), { timeout: 60_000 });
    await loginPage.signInButton.click();
    const status = (await response).status();
    test.info().annotations.push({ type: 'refused sign-in', description: `${account.username}: ${status}` });
    expect(status, 'login refused').toBeGreaterThanOrEqual(400);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert').first()).toBeVisible();
  });
}

test('Phase 4: users - invite, My account password, promote/demote, disable, CER panel', async ({ page }) => {
  const notes = test.info().annotations;
  notes.push({ type: 'data', description: `colleague=${colleague.username}` });
  await startSession(page);
  let colleagueId = '';

  // ---------------------------------------------------------------- 1. sunvolt.admin invites
  await test.step('sunvolt.admin: invites a colleague as User', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    await expect(page.getByRole('banner')).toContainText('participant_admin');
    const users = await UsersPanel.openOwn(page);
    await expect(users.row('sunvolt.admin')).toContainText('(you)');
    await expect(users.row('sunvolt.admin').getByRole('button'), 'no actions on your own row').toHaveCount(0);

    const res = await users.invite({ username: colleague.username, displayName: colleague.displayName, role: 'User', password: colleague.initialPassword });
    expect(res.status(), `invite: ${(await res.text()).slice(0, 300)}`).toBe(201);
    colleagueId = (await res.json()).id;
    await expect(users.row(colleague.username)).toBeVisible({ timeout: 30_000 });
    await expect(users.cell(colleague.username, 'Role')).toHaveText('User');
    await expect(users.cell(colleague.username, 'Status')).toHaveText('Active');
    await expect(users.cell(colleague.username, 'Sign-in')).toHaveText('Password');
    record({ event: 'user.invited', status: 'participant_user', username: colleague.username, userId: colleagueId, participant: 'SunVolt' });
  });

  // ---------------------------------------------------------------- 2. colleague: Users forbidden, My account
  await test.step('colleague: Users is admin-only', async () => {
    await signInAsSeed(page, login(colleague.username, colleague.initialPassword));
    await expect(page.getByRole('banner')).toContainText('participant_user');
    const users = await UsersPanel.openOwn(page);
    await expect(users.adminOnlyNotice).toBeVisible({ timeout: 30_000 });
    await expect(users.table).toHaveCount(0);
  });

  await test.step('colleague: My account - wrong current password refused, then password changed', async () => {
    const account = new MyAccountPage(page);
    await account.open();
    await expect(account.signedInAs).toContainText(colleague.username);
    await expect(account.signedInAs).toContainText('participant_user');
    const crumb = (await account.breadcrumb.innerText()).replace(/\s+/g, ' ');
    expect.soft(crumb, 'breadcrumb names the page').toContain('My account');
    if (!crumb.includes('My account')) reportIssue(`My account breadcrumb reads "${crumb}"`);

    // The rejected request is also logged by the browser as a 403 console error (reported by watchConsoleErrors).
    const wrong = await account.changePassword('not-my-password-at-all', colleague.newPassword);
    expect(wrong.status(), 'wrong current password').toBe(403);
    await expect(account.main.getByRole('alert')).toContainText(/current password is incorrect/i);

    const ok = await account.changePassword(colleague.initialPassword, colleague.newPassword);
    expect(ok.status(), 'change password').toBe(204);
    await expect(account.changed).toBeVisible();
  });

  await test.step('colleague: old password refused, new password signs in', async () => {
    await expectSignInRefused(page, login(colleague.username, colleague.initialPassword));
    await signInAsSeed(page, login(colleague.username, colleague.newPassword));
    await expect(page.getByRole('banner')).toContainText('participant_user');
  });

  // ---------------------------------------------------------------- 3. promote
  await test.step('sunvolt.admin: promotes the colleague to Administrator', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    const users = await UsersPanel.openOwn(page);
    const res = await users.act(colleague.username, 'Make administrator');
    expect(res.status(), `promote: ${(await res.text()).slice(0, 200)}`).toBe(200);
    await expect(users.cell(colleague.username, 'Role')).toHaveText('Administrator', { timeout: 30_000 });
    record({ event: 'user.updated', status: 'participant_admin', username: colleague.username, participant: 'SunVolt' });
  });

  // ---------------------------------------------------------------- 4. colleague as admin: cannot change own role
  await test.step('colleague (administrator): manages others but not their own role', async () => {
    await signInAsSeed(page, login(colleague.username, colleague.newPassword));
    await expect(page.getByRole('banner')).toContainText('participant_admin');
    const users = await UsersPanel.openOwn(page);
    await expect(users.row(colleague.username)).toContainText('(you)');
    await expect(users.row(colleague.username).getByRole('button'), 'no actions on your own row').toHaveCount(0);
    // With two administrators sunvolt.admin is no longer the last one, so its actions are enabled.
    await expect(users.action('sunvolt.admin', 'Make user')).toBeEnabled();
    const self = await pageApi(page, 'PATCH', `/participants/me/users/${colleagueId}`, { role: 'participant_user' });
    expect(self.status, `own role change refused: ${self.text.slice(0, 200)}`).toBe(409);
    expect(self.json?.detail).toMatch(/own account/i);
  });

  // ---------------------------------------------------------------- 5. demote + disable
  await test.step('sunvolt.admin: demotes and disables the colleague; cannot change own role', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    const users = await UsersPanel.openOwn(page);
    const demote = await users.act(colleague.username, 'Make user');
    expect(demote.status(), 'demote').toBe(200);
    await expect(users.cell(colleague.username, 'Role')).toHaveText('User', { timeout: 30_000 });
    const disable = await users.act(colleague.username, 'Disable');
    expect(disable.status(), 'disable').toBe(200);
    await expect(users.cell(colleague.username, 'Status')).toHaveText(/disabled/i, { timeout: 30_000 });
    record({ event: 'user.updated', status: 'disabled', username: colleague.username, participant: 'SunVolt' });

    const me = (await pageApi(page, 'GET', '/auth/me')).json;
    const self = await pageApi(page, 'PATCH', `/participants/me/users/${me.id}`, { role: 'participant_user' });
    expect(self.status, `sunvolt.admin own role change refused: ${self.text.slice(0, 200)}`).toBe(409);
  });

  await test.step('colleague: disabled account cannot sign in', async () => {
    await expectSignInRefused(page, login(colleague.username, colleague.newPassword));
  });

  // ---------------------------------------------------------------- 6. cer.admin manages from the participant page
  await test.step('cer.admin: SunVolt Users panel - last administrator protected, re-enable and disable', async () => {
    await signInAsSeed(page, seedAccount('cer.admin'));
    const users = await UsersPanel.openForParticipant(page, sunvolt);
    await expect(users.table).toBeVisible();
    await expect(users.inviteButton).toBeVisible();
    await expect(users.cell(colleague.username, 'Status')).toHaveText(/disabled/i);
    await expect(users.action('sunvolt.admin', 'Make user'), 'last administrator cannot be demoted').toBeDisabled();
    await expect(users.action('sunvolt.admin', 'Disable'), 'last administrator cannot be disabled').toBeDisabled();

    const enable = await users.act(colleague.username, /^(Re-?enable|Enable)$/i);
    expect(enable.status(), 'CER re-enable').toBe(200);
    await expect(users.cell(colleague.username, 'Status')).toHaveText('Active', { timeout: 30_000 });
    const disable = await users.act(colleague.username, 'Disable');
    expect(disable.status(), 'CER disable').toBe(200);
    await expect(users.cell(colleague.username, 'Status')).toHaveText(/disabled/i, { timeout: 30_000 });
  });

  // ---------------------------------------------------------------- 7. cer.officer read-only
  await test.step('cer.officer: SunVolt Users panel is read-only', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    const users = await UsersPanel.openForParticipant(page, sunvolt);
    const readable = await users.table.isVisible();
    expect.soft(readable, 'cer.officer can view SunVolt users').toBe(true);
    if (!readable) {
      reportIssue(`cer.officer: participant Users panel shows "${(await users.forbidden.innerText().catch(() => '')).replace(/\s+/g, ' ')}" - walkthrough says read-only access`);
    } else {
      await expect(users.inviteButton, 'no Invite for cer.officer').toHaveCount(0);
      await expect(users.root.getByRole('button', { name: /^(Make|Disable|Enable)/ }).and(page.locator(':enabled'))).toHaveCount(0);
    }
  });

  await signOut(page);
});

test('Phase 4: participant incidents - report in scope, 404 out of scope, CER status flow, isolation audited', async ({ page }) => {
  const notes = test.info().annotations;
  await startSession(page);
  const title = `E2E P4 ${stamp}: battery isolator trips under load`;
  const description = `E2E Phase 4 run ${stamp}. Isolator tripped three times during evening discharge; no damage observed.`;
  const isolationStarted = new Date().toISOString();
  let outOfScopeUnit = '';
  let incidentId = '';

  // ---------------------------------------------------------------- 1. setup: a SunVolt unit GridCell is not party to
  await test.step('sunvolt.admin (setup): register a fresh SV-BAT-10 unit', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    const serial = `SVB10-P4-${stamp}`;
    const res = await pageApi(page, 'POST', '/devices/units',
      { modelId: SEED.models.svBat10, serial, batch: `E2E-${stamp}`, attributes: { usable_capacity_kwh: 9.6 } });
    expect(res.status, `POST /api/devices/units: ${res.text.slice(0, 300)}`).toBe(201);
    outOfScopeUnit = res.json.id;
    record({ event: 'unit.acquired', status: 'registered', deviceId: outOfScopeUnit, modelId: SEED.models.svBat10, serialNumber: serial, participant: 'SunVolt' });
    notes.push({ type: 'out-of-scope unit', description: `${outOfScopeUnit} serial ${serial}` });
  });

  // ---------------------------------------------------------------- 2. gridcell.admin reports
  const report = new ReportIncidentPage(page);
  const incident = new IncidentPage(page);

  await test.step('gridcell.admin: a unit not in its scope is 404', async () => {
    await signInAsSeed(page, seedAccount('gridcell.admin'));
    await expect(page.getByRole('banner')).toContainText('participant_admin');
    await report.open();
    const res = await report.report({ unitId: outOfScopeUnit, severity: 'low', title: `${title} (out of scope)`, description });
    expect(res.status(), 'out-of-scope unit').toBe(404);
    await expect(report.error).toContainText(/not found/i);
    await expect(page, 'stays on the form').toHaveURL(/\/participant\/incidents\/new/);
  });

  await test.step('gridcell.admin: reports an incident on SVB10-24-000101 (installed by GridCell, owned by SunVolt)', async () => {
    await report.open();
    const res = await report.report({ unitId: UNIT_101.id, severity: 'high', title, description, occurredOn: '2026-11-14', evidenceRef: `E2E-JOB-${stamp}` });
    expect(res.status(), `report: ${(await res.text()).slice(0, 300)}`).toBe(201);
    incidentId = (await res.json()).id;
    notes.push({ type: 'incident', description: incidentId });
    await page.waitForURL(u => u.pathname.endsWith(`/participant/incidents/${incidentId}`), { timeout: 30_000 });
    await incident.expectIncident(incidentId);
    await expect(incident.heading).toHaveText(title);
    await incident.expectStatus('open');
    await expect(incident.field('Unit')).toHaveText(UNIT_101.serial);
    await expect(incident.field('Model')).toHaveText('SV-BAT-10');
    await expect(incident.field('Manufacturer')).toContainText('SunVolt');
    await expect(incident.field('Reported by')).toContainText('GridCell');
    await expect(incident.field('Date observed')).toHaveText('2026-11-14');
    await expect(incident.field('Evidence')).toHaveText(`E2E-JOB-${stamp}`);
    await expect(incident.changeStatusHeading, 'participants cannot change status').toHaveCount(0);
    expect((await incident.timelineRows()).map(r => r.event)).toEqual(['raised']);
    record({ event: 'incident.raised', status: 'open', incidentId, unitId: UNIT_101.id, serialNumber: UNIT_101.serial, participant: 'GridCell' });
  });

  await test.step('gridcell.admin: sees only incidents it reported; adds a note', async () => {
    const list = new IncidentsPage(page, 'participant');
    await list.open();
    await expect(list.main.getByRole('columnheader', { name: 'Reported by' }), 'no reporter column - all are own').toHaveCount(0);
    const all = await pageApi(page, 'GET', '/incidents');
    for (const i of all.json.items) expect(i.reportedByParticipantId, `${i.id} in GridCell's list`).toBe(gridcell);
    const res = await list.searchFor(incidentId);
    expect(res.status()).toBe(200);
    await expect(list.rows).toHaveCount(1);
    await expect(await list.cell(incidentId, 'Status')).toHaveText('open');
    await list.row(incidentId).getByRole('link', { name: title }).click();
    await incident.expectIncident(incidentId);
    const note = await incident.addNote(`E2E ${stamp}: isolator replaced on site, monitoring.`);
    expect(note.status(), 'add note').toBe(200);
    await expect(incident.timeline).toContainText('isolator replaced on site', { timeout: 30_000 });
  });

  await test.step('gridcell.admin: cross-tenant requests are refused', async () => {
    const model = await pageApi(page, 'GET', `/devices/models/${SEED.models.svBat20}`);
    expect(model.status, `GET SunVolt model SV-BAT-20: ${model.text.slice(0, 200)}`).toBe(404);
    const patch = await pageApi(page, 'PATCH', `/participants/${sunvolt}`, { details: { tradingName: 'Not GridCell' }, changeReason: 'E2E cross-tenant attempt' });
    expect(patch.status, `PATCH SunVolt: ${patch.text.slice(0, 200)}`).toBe(403);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 3. cer.officer status flow
  await test.step('cer.officer: sees the reporter; moves the incident through every status', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    const list = new IncidentsPage(page, 'cer');
    await list.open();
    await list.searchFor(incidentId);
    await expect(list.rows).toHaveCount(1);
    await expect(await list.cell(incidentId, 'Reported by')).toHaveText(/GridCell/);
    await list.row(incidentId).getByRole('link', { name: title }).click();
    await incident.expectIncident(incidentId);
    await expect(incident.timeline, 'participant note visible to CER').toContainText('isolator replaced on site');

    const skip = await incident.changeStatus('resolved', 'E2E: skipping ahead must be refused');
    expect(skip.status(), 'open -> resolved refused').toBe(409);
    await expect(incident.main.getByRole('alert')).toContainText(/open to resolved/i);
    await page.reload({ waitUntil: 'commit' });
    await incident.expectIncident(incidentId);
    await incident.expectStatus('open');

    for (const status of ['acknowledged', 'investigating', 'resolved', 'closed'] as const) {
      const res = await incident.changeStatus(status, `E2E ${stamp}: CER marks ${status}`);
      expect(res.status(), `-> ${status}: ${(await res.text()).slice(0, 200)}`).toBe(200);
      await incident.expectStatus(status);
      await expect(incident.timeline).toContainText(`CER marks ${status}`, { timeout: 30_000 });
      record({ event: 'incident.status', status, incidentId });
    }
  });

  await signOut(page);

  // ---------------------------------------------------------------- 4. gridcell.admin sees the outcome
  await test.step('gridcell.admin: sees CER status changes and reasons', async () => {
    await signInAsSeed(page, seedAccount('gridcell.admin'));
    await incident.open('participant', incidentId);
    await incident.expectStatus('closed');
    const rows = await incident.timelineRows();
    notes.push({ type: 'timeline', description: rows.map(r => `${r.event}: ${r.note}`).join(' | ').slice(0, 800) });
    for (const status of ['acknowledged', 'investigating', 'resolved', 'closed']) {
      expect(rows.some(r => r.note.includes(`CER marks ${status}`)), `reason for ${status} visible to reporter`).toBe(true);
    }
    await expect(incident.changeStatusHeading).toHaveCount(0);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 5. cer.admin: denials audited
  await test.step('cer.admin: both isolation attempts are audited as access.denied', async () => {
    await signInAsSeed(page, seedAccount('cer.admin'));
    const denied = async () => {
      const r = await pageApi(page, 'GET', `/audit/events?action=access.denied&actor=gridcell.admin&from=${encodeURIComponent(isolationStarted)}&limit=100`);
      const r2 = r.status === 200 ? r : await pageApi(page, 'GET', '/audit/events?action=access.denied&limit=200');
      return (r2.json?.items ?? [])
        .filter((e: any) => e.actorUsername === 'gridcell.admin' && e.occurredAt >= isolationStarted)
        .map((e: any) => `${e.detail?.method} ${e.detail?.url}`);
    };
    await expect.poll(denied, { timeout: 30_000 }).toEqual(expect.arrayContaining([
      `GET /devices/models/${SEED.models.svBat20}`,
      `PATCH /participants/${sunvolt}`,
    ]));
    const seen: string[] = await denied();
    notes.push({ type: 'access.denied (gridcell.admin, this run)', description: seen.join(' | ') });
    expect.soft(seen, 'out-of-scope incident report audited').toContain('POST /incidents');
    if (!seen.includes('POST /incidents')) reportIssue('Out-of-scope POST /incidents (404) is not written to audit.events as access.denied');
  });

  await signOut(page);
});
