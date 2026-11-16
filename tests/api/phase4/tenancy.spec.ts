import { test, expect } from '@playwright/test';
import { ApiClient, ApiResult, AuditApi, IncidentsApi, ParticipantUsersApi } from '../../../api';
import { SEED, seedApiClient } from '../../../utils/seed-accounts';
import { reportIssue } from '../../../utils/issues';

/**
 * Phase 4 tenant isolation through the API (no browser). Seed accounts, SANDBOX_SEED_PASSWORD.
 *
 * The API scopes every participant query by the token's participant_id and Row-Level Security
 * underneath returns no rows for anything out of scope. Denied cross-tenant attempts are 403, or 404
 * for a record that exists but is out of scope, and are written to audit.events as access.denied
 * (read here through GET /audit/events?action=access.denied as cer.admin).
 *
 * Nothing is created: every request below is one the server must refuse. Where a refusal is accepted
 * by mistake the test restores the record (GridCell's only administrator) before failing.
 */

const { sunvolt, gridcell } = SEED.participants;
const problem = (r: ApiResult<unknown>) => `${r.status} ${JSON.stringify(r.problem ?? r.body).slice(0, 300)}`;

/**
 * Polls the audit log (newest 200) for an access.denied event by actor for METHOD url.
 * soft: a missing event is a soft failure + 'issue' annotation instead of stopping the test.
 */
async function expectDenialAudited(audit: AuditApi, actor: string, method: string, url: string, soft = false) {
  const find = async () => {
    const r = await audit.events({ action: 'access.denied', limit: 200 });
    expect(r.status, problem(r)).toBe(200);
    return r.body.items.some(e => e.actorUsername === actor && e.detail?.method === method && e.detail?.url === url);
  };
  const message = `access.denied audited for ${actor} ${method} ${url}`;
  if (!soft) return expect.poll(find, { message, timeout: 15_000 }).toBe(true);
  const found = await expect.poll(find, { timeout: 15_000 }).toBe(true).then(() => true, () => false);
  expect.soft(found, message).toBe(true);
  if (!found) reportIssue(`Denied ${method} ${url} by ${actor} is not written to audit.events as access.denied`);
}

test.describe('Phase 4: tenancy and participant isolation (API)', () => {
  let gc: ApiClient;
  let cerAdmin: ApiClient;
  let audit: AuditApi;

  test.beforeEach(async ({ request }) => {
    gc = await seedApiClient(request, 'gridcell.admin');
    cerAdmin = await seedApiClient(request, 'cer.admin');
    audit = new AuditApi(cerAdmin);
  });

  test('gridcell.admin: a SunVolt model it has no units of is 404, PATCH SunVolt is 403; both audited', async () => {
    const model = await gc.get(`/devices/models/${SEED.models.svBat20}`);
    expect(model.status, problem(model)).toBe(404);

    const patch = await gc.patch(`/participants/${sunvolt}`, { details: { tradingName: 'Not GridCell' }, changeReason: 'E2E cross-tenant attempt' });
    expect(patch.status, problem(patch)).toBe(403);

    await expectDenialAudited(audit, 'gridcell.admin', 'GET', `/devices/models/${SEED.models.svBat20}`);
    await expectDenialAudited(audit, 'gridcell.admin', 'PATCH', `/participants/${sunvolt}`);
  });

  test('gridcell.admin: reads only its own scope - own participant users, no SunVolt users', async () => {
    const own = await new ParticipantUsersApi(gc).list();
    expect(own.status, problem(own)).toBe(200);
    expect(own.body.items.map(u => u.username)).toContain('gridcell.admin');
    expect(own.body.items.map(u => u.username)).not.toContain('sunvolt.admin');

    // A SunVolt user id addressed through GridCell's own scope does not exist for GridCell.
    const svUsers = await new ParticipantUsersApi(cerAdmin).list(sunvolt);
    const svAdmin = svUsers.body.items.find(u => u.username === 'sunvolt.admin')!;
    const cross = await new ParticipantUsersApi(gc).update(svAdmin.id, { disabled: false });
    expect(cross.status, problem(cross)).toBe(404);
    await expectDenialAudited(audit, 'gridcell.admin', 'PATCH', `/participants/me/users/${svAdmin.id}`, true);

    // ... nor can GridCell use the CER route for another participant.
    const cerRoute = await gc.get(`/participants/${sunvolt}/users`);
    expect(cerRoute.status, problem(cerRoute)).toBe(403);
  });

  test('sunvolt.user: Users is admin-only (self:users) - 403 and audited', async ({ request }) => {
    const svUser = await seedApiClient(request, 'sunvolt.user');
    const r = await new ParticipantUsersApi(svUser).list();
    expect(r.status, problem(r)).toBe(403);
    await expectDenialAudited(audit, 'sunvolt.user', 'GET', '/participants/me/users');
  });

  test('CER: cer.admin manages any participant\'s users, cer.officer reads only', async ({ request }) => {
    const admin = await new ParticipantUsersApi(cerAdmin).list(sunvolt);
    expect(admin.status, problem(admin)).toBe(200);
    expect(admin.body.items.map(u => u.username)).toEqual(expect.arrayContaining(['sunvolt.admin', 'sunvolt.user']));

    const officer = new ParticipantUsersApi(await seedApiClient(request, 'cer.officer'));
    const read = await officer.list(sunvolt);
    expect.soft(read.status, `cer.officer can read SunVolt users: ${problem(read)}`).toBe(200);
    if (read.status !== 200) reportIssue(`cer.officer GET /participants/{id}/users returned ${read.status} - walkthrough says cer.officer is read-only (can view)`);

    const svUser = admin.body.items.find(u => u.username === 'sunvolt.user')!;
    const write = await officer.update(svUser.id, { disabled: svUser.disabled }, sunvolt); // no-op if wrongly allowed
    expect(write.status, `cer.officer may not manage users: ${problem(write)}`).toBe(403);
  });

  test('last active administrator cannot be demoted or disabled; nobody can change their own role', async () => {
    const users = new ParticipantUsersApi(cerAdmin);
    const list = await users.list(gridcell);
    const admins = list.body.items.filter(u => u.role === 'participant_admin' && !u.disabled);
    test.skip(admins.length !== 1, `GridCell has ${admins.length} active administrators - needs exactly one`);
    const only = admins[0];
    const restore = () => users.update(only.id, { role: 'participant_admin', disabled: false }, gridcell);

    const demote = await users.update(only.id, { role: 'participant_user' }, gridcell);
    if (demote.ok) await restore();
    expect(demote.status, problem(demote)).toBe(409);
    expect(demote.problem?.detail).toMatch(/at least one active administrator/i);

    const disable = await users.update(only.id, { disabled: true }, gridcell);
    if (disable.ok) await restore();
    expect(disable.status, problem(disable)).toBe(409);

    const self = await new ParticipantUsersApi(gc).update(only.id, { role: 'participant_user' });
    if (self.ok) await restore();
    expect(self.status, problem(self)).toBe(409);
    expect(self.problem?.detail).toMatch(/own account/i);
  });

  test('POST /auth/password: wrong current password is refused and audited; short new password rejected', async () => {
    const wrong = await gc.post('/auth/password', { currentPassword: 'definitely-not-it', newPassword: 'Another-Pass-2026!' });
    expect(wrong.status, problem(wrong)).toBe(403);
    expect(wrong.problem?.detail).toMatch(/current password is incorrect/i);
    await expectDenialAudited(audit, 'gridcell.admin', 'POST', '/auth/password');

    const short = await gc.post('/auth/password', { currentPassword: 'definitely-not-it', newPassword: 'Short!1a' });
    expect([400, 422], problem(short)).toContain(short.status);
  });

  test('participant user invitation validates username and password length', async () => {
    const r = await new ParticipantUsersApi(gc).invite({ username: 'x', displayName: 'x', role: 'participant_user', password: 'short' });
    expect([400, 422], problem(r)).toContain(r.status);
    const fields = ((r.problem?.errors ?? []) as { field?: string }[]).map(e => e.field);
    expect(fields).toEqual(expect.arrayContaining(['username', 'password']));
  });

  test('incidents: participants see only their own reports and cannot change status', async () => {
    const all = await new IncidentsApi(cerAdmin).list();
    expect(all.status, problem(all)).toBe(200);
    const foreign = all.body.items.find(i => i.reportedByParticipantId !== gridcell);
    test.skip(!foreign, 'no incident reported by anyone other than GridCell');

    const incidents = new IncidentsApi(gc);
    const mine = await incidents.list();
    expect(mine.status, problem(mine)).toBe(200);
    for (const i of mine.body.items) expect(i.reportedByParticipantId, `${i.id} in GridCell's list`).toBe(gridcell);

    const read = await incidents.get(foreign!.id);
    expect(read.status, problem(read)).toBe(404);
    await expectDenialAudited(audit, 'gridcell.admin', 'GET', `/incidents/${foreign!.id}`);

    const own = mine.body.items[0];
    if (own) {
      const status = await incidents.changeStatus(own.id, { status: 'acknowledged', note: 'participant attempt' });
      expect(status.status, `participant status change on ${own.id}: ${problem(status)}`).toBe(403);
    }
  });

  test('incidents: a unit outside the reporter\'s scope is 404', async () => {
    // A SunVolt-owned unit GridCell has never been party to: GridCell cannot read it and did not install it.
    const units = await cerAdmin.get<{ items: { id: string; serial: string }[] }>(`/devices/units?ownerParticipantId=${sunvolt}&limit=50`);
    const installed = await cerAdmin.get<{ items: { unitId: string }[] }>(`/devices/installations?installerParticipantId=${gridcell}&limit=200`);
    const gcInstalled = new Set(installed.body.items.map(i => i.unitId));
    let target: { id: string; serial: string } | undefined;
    for (const u of units.body.items.filter(u => !gcInstalled.has(u.id))) {
      if ((await gc.get(`/devices/units/${u.id}`)).status === 404) { target = u; break; }
    }
    test.skip(!target, 'no SunVolt unit outside GridCell scope found');
    test.info().annotations.push({ type: 'out-of-scope unit', description: `${target!.serial} ${target!.id}` });

    const r = await new IncidentsApi(gc).report({
      unitId: target!.id, severity: 'low', title: 'E2E out-of-scope report',
      description: 'Must be refused: GridCell is not a party to this unit.',
    });
    expect(r.status, problem(r)).toBe(404);
    await expectDenialAudited(audit, 'gridcell.admin', 'POST', '/incidents', true);
  });

  test('incidents: CER status changes follow open -> acknowledged -> investigating -> resolved -> closed', async () => {
    const all = await new IncidentsApi(cerAdmin).list({ status: 'open' });
    const open = all.body.items[0];
    test.skip(!open, 'no open incident to probe');
    // Skipping ahead must be refused - nothing changes.
    const skip = await new IncidentsApi(cerAdmin).changeStatus(open.id, { status: 'resolved', note: 'E2E skip-ahead probe' });
    expect(skip.status, problem(skip)).toBe(409);
    expect(skip.problem?.detail).toMatch(/from open to resolved/i);
  });
});
