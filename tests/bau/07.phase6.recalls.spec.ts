import { Page, expect, test } from '@playwright/test';
import { HistoryPanel, ModelReviewPage, RecallPage, RecallsPage } from '../../pages';
import { COASTAL_SIM, SEED, SV_BAT_10_UNITS, SeedAccount, seedAccount, signInAsSeed } from '../../utils/seed-accounts';
import { signOut, startSession } from '../../utils/session';
import { pageApi } from '../../utils/page-api';
import { reportIssue } from '../../utils/issues';
import { record } from '../../utils/ledger';
import { decommissionUnit, registerBatteryModel, registerUnit, setModelStatus, transferUnit } from '../../utils/register-setup';

/**
 * Phase 6 walkthrough - recalls, affected units and model withdrawal.
 *
 * Test 1 - batch recall on SV-BAT-10 (seed data, as in the walkthrough):
 *   1. cer.officer    Raise a recall: SV-BAT-10, batches B2607-A, critical, linked to a GridCell incident (when one
 *                     is free). SVB10-24-000101 and …102 resolve, both installed by GridCell, so GridCell is
 *                     responsible; …103 (B2607-B) is out of scope. Each unit is snapshotted with installation/NMI.
 *   2. gridcell.admin Recalls: expands a unit, adds a note with an evidence reference, Mark acknowledged, Mark remediated.
 *   3. sunvolt.admin  Sees the same units as manufacturer but cannot progress them (403).
 *   4. outsider       A participant with no part in these records cannot see the recall (404). The walkthrough uses
 *                     coastal.admin, which is not seeded on cerpoc, so a stand-in admin is created once under
 *                     Coastal Energy Solutions (SIM) by cer.admin.
 *   5. cer.officer    Close recall refused (409) while units are open; Set unit verified, then closed for each unit.
 *                     Re-resolve units adds a unit registered against the batch after the recall was raised; CER
 *                     closes it outright with a reason; the recall closes once every unit is closed.
 *
 * Test 2 - model-wide recall with Withdraw the model, on a model registered for this run (withdrawing SV-BAT-10
 * would stop Phases 2, 3 and 5 registering units of it):
 *   sunvolt.admin registers + cer.admin approves a model; two units (one SunVolt-owned, one transferred to GridCell).
 *   cer.officer raises the recall with Withdraw ticked: the model flips to withdrawn with a history version citing
 *   the recall, both units are captured with the owner responsible, and a new unit of the model is refused.
 *   gridcell.admin sees only the unit it owns; CER closes each unit outright and then the recall.
 *
 * Clean-up: every recall raised is closed; the re-resolved unit is decommissioned so later runs still resolve two units.
 * Deviations from the walkthrough are soft failures + 'issue' annotations so the flow continues.
 */

const { sunvolt, gridcell } = SEED.participants;
const { u101, u102, u103 } = SV_BAT_10_UNITS;
const stamp = Date.now().toString(36).toUpperCase();
const OUTSIDER = { username: 'e2e.coastal.admin', password: 'E2e-Coastal-Outsider-2026!' };

test.describe.configure({ timeout: 900_000 });
test.use({ actionTimeout: 30_000 });

interface ApiAffectedUnit {
  unitId: string; serial: string; batch: string | null; status: string; unitStatusAtRecall: string;
  installationId: string | null; nmi: string | null; ownerParticipantId: string; installerParticipantId: string | null;
  responsibleParticipantId: string; responsibleParticipantName: string;
}
interface ApiRecall {
  id: string; status: string; modelStatus: string; incidentId: string | null; batches: string[] | null;
  counts: Record<string, number>; affectedUnits: ApiAffectedUnit[]; events: { kind: string; note: string | null }[];
}

const getRecall = async (page: Page, id: string) => pageApi(page, 'GET', `/recalls/${id}`);
const recallBody = async (page: Page, id: string): Promise<ApiRecall> => (await getRecall(page, id)).json;

/** Signs in the outsider, creating it under Coastal (SIM) as cer.admin the first time. */
async function outsiderAccount(page: Page): Promise<SeedAccount | undefined> {
  const login = await page.request.post(`${new URL(process.env.BASE_URL!).origin}/api/auth/login`,
    { data: { username: 'coastal.admin', password: seedAccount('cer.admin').password } });
  if (login.ok()) return seedAccount('coastal.admin');
  reportIssue('Walkthrough account coastal.admin is not seeded on this sandbox - using a stand-in admin under Coastal Energy Solutions (SIM)');
  const existing = await page.request.post(`${new URL(process.env.BASE_URL!).origin}/api/auth/login`, { data: OUTSIDER });
  if (existing.ok()) return OUTSIDER;
  await signInAsSeed(page, seedAccount('cer.admin'));
  const res = await pageApi(page, 'POST', `/participants/${COASTAL_SIM}/users`,
    { username: OUTSIDER.username, displayName: 'E2E Coastal outsider', role: 'participant_admin', password: OUTSIDER.password });
  if (res.status !== 201) { reportIssue(`Could not create the outsider account: ${res.status} ${res.text.slice(0, 200)}`); return undefined; }
  record({ event: 'user.invited', status: 'participant_admin', username: OUTSIDER.username, participant: 'Coastal Energy Solutions (SIM)' });
  return OUTSIDER;
}

test('Phase 6: batch recall - snapshot, responsible participant, visibility, verify/close, re-resolve', async ({ page }) => {
  const notes = test.info().annotations;
  await startSession(page);
  const recalls = new RecallsPage(page, 'cer');
  const recall = new RecallPage(page);
  let recallId = '';
  let lateUnit = { id: '', serial: `SVB10-P6-${stamp}` };

  // ---------------------------------------------------------------- 1. raise
  await test.step('cer.officer: raise a critical recall on SV-BAT-10 batch B2607-A', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    await expect(page.getByRole('banner')).toContainText('cer_officer');
    const incidents = (await pageApi(page, 'GET', `/incidents?q=${u101.serial}`)).json?.items ?? [];
    const incident = incidents.find((i: any) => i.reportedByParticipantId === gridcell && !i.recallId);
    if (!incident) notes.push({ type: 'linked incident', description: 'none free (each GridCell incident on SVB10-24-000101 is already linked) - raised without a link' });

    const res = await recalls.raise({
      modelId: SEED.models.svBat10, batches: [u101.batch], incidentId: incident?.id, severity: 'critical',
      title: `E2E P6 ${stamp}: battery module swelling (B2607-A)`,
      description: 'Swelling observed in battery modules from batch B2607-A; risk of thermal event.',
      remedy: 'Inspect each unit and replace the battery module where swelling is found.',
    });
    expect(res.status(), `raise: ${(await res.text()).slice(0, 300)}`).toBe(201);
    recallId = (await res.json()).id;
    expect(recallId).toMatch(/^CER-R-/);
    notes.push({ type: 'recall', description: `${recallId}${incident ? ` linked to ${incident.id}` : ''}` });
    record({ event: 'recall.raised', status: 'open', recallId, modelId: SEED.models.svBat10, batches: u101.batch });

    await page.waitForURL(u => u.pathname.endsWith(`/cer/recalls/${recallId}`), { timeout: 30_000 }).catch(() => recall.open('cer', recallId));
    await recall.expectRecall(recallId);
    await expect(recall.field('Scope')).toHaveText(`Batches ${u101.batch}`);
    if (incident) await expect(recall.field('Linked incident')).toHaveText(incident.id);

    const body = await recallBody(page, recallId);
    const serials = body.affectedUnits.map(u => u.serial);
    notes.push({ type: 'affected units', description: body.affectedUnits.map(u => `${u.serial} ${u.batch} ${u.unitStatusAtRecall} NMI ${u.nmi} resp ${u.responsibleParticipantName}`).join(' | ') });
    expect(serials).toEqual(expect.arrayContaining([u101.serial, u102.serial]));
    expect(serials, 'B2607-B unit out of scope').not.toContain(u103.serial);
    expect.soft(serials.length, 'exactly the two seeded B2607-A units (others are left over from earlier runs)').toBe(2);
    for (const u of body.affectedUnits.filter(x => ([u101.id, u102.id] as string[]).includes(x.unitId))) {
      expect(u.unitStatusAtRecall).toBe('installed');
      expect(u.installationId, `${u.serial} snapshot holds the active installation`).toMatch(/^CER-I-/);
      expect(u.nmi).toBeTruthy();
      expect(u.ownerParticipantId, `${u.serial} owner`).toBe(sunvolt);
      expect(u.installerParticipantId, `${u.serial} installer`).toBe(gridcell);
      expect(u.responsibleParticipantId, `${u.serial} installer is responsible`).toBe(gridcell);
      expect(u.status).toBe('notified');
    }
    const block = await recall.expand(u101.serial);
    await expect(recall.unitField(block, 'Responsible')).toHaveText(/GridCell/);
    await expect(recall.unitField(block, 'Status at recall')).toHaveText('installed');
    expect((await recall.trail(block)).map(r => r.event)).toEqual(['notified']);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 2. gridcell acknowledges and remediates
  await test.step('gridcell.admin: note with evidence, Mark acknowledged, Mark remediated (each unit)', async () => {
    await signInAsSeed(page, seedAccount('gridcell.admin'));
    const list = new RecallsPage(page, 'participant');
    await list.open();
    await expect(list.link(recallId)).toBeVisible({ timeout: 30_000 });
    await list.link(recallId).click();
    await recall.expectRecall(recallId);
    for (const u of [u101, u102]) {
      const note = await recall.addUnitNote(u.serial, `E2E ${stamp}: site visit booked for ${u.serial}`, `E2E-JOB-${stamp}`);
      expect(note.status(), 'unit note').toBe(200);
      expect((await recall.markUnit(u.serial, 'acknowledged', `E2E ${stamp}: owner notified, unit isolated`)).status()).toBe(200);
      expect((await recall.markUnit(u.serial, 'remediated', `E2E ${stamp}: battery module replaced`, `E2E-CERT-${stamp}`)).status()).toBe(200);
    }
    const block = await recall.expand(u101.serial);
    await expect.poll(async () => (await recall.trail(block)).map(r => r.event), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['notified', 'note', 'acknowledged', 'remediated']));
    const trail = await recall.trail(block);
    expect(trail.some(r => r.evidence.includes(`E2E-JOB-${stamp}`)), 'evidence reference on the trail').toBe(true);
    await expect(block.getByRole('button', { name: /^Set unit/ }), 'verification is CER-only').toHaveCount(0);
    const verify = await pageApi(page, 'POST', `/recalls/${recallId}/units/${u101.id}/status`, { status: 'verified', note: 'participant attempt' });
    expect(verify.status, `GridCell cannot verify: ${verify.text.slice(0, 200)}`).toBe(403);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 3. sunvolt: sees, cannot progress
  await test.step('sunvolt.admin: sees the units as manufacturer but cannot progress them (403)', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    await recall.open('participant', recallId);
    for (const u of [u101, u102]) await expect(recall.unit(u.serial)).toBeVisible();
    const block = await recall.expand(u102.serial);
    await expect(block.getByRole('button', { name: /^Mark / }), 'no progress actions for the manufacturer').toHaveCount(0);
    const res = await pageApi(page, 'POST', `/recalls/${recallId}/units/${u102.id}/status`, { status: 'acknowledged', note: 'manufacturer attempt' });
    expect(res.status, res.text.slice(0, 200)).toBe(403);
  });

  // ---------------------------------------------------------------- 3b. late unit for Re-resolve (registered after the recall)
  await test.step('sunvolt.admin (setup): registers another B2607-A unit after the recall was raised', async () => {
    lateUnit.id = await registerUnit(page, lateUnit.serial, u101.batch);
    notes.push({ type: 'late unit', description: `${lateUnit.id} ${lateUnit.serial}` });
  });

  await signOut(page);

  // ---------------------------------------------------------------- 4. outsider: 404
  await test.step('outsider (coastal): cannot see the recall at all (404)', async () => {
    const outsider = await outsiderAccount(page);
    expect.soft(outsider, 'an outsider account is available').toBeDefined();
    if (!outsider) return;
    await signInAsSeed(page, outsider);
    const res = await getRecall(page, recallId);
    expect(res.status, 'outsider GET recall').toBe(404);
    const list = new RecallsPage(page, 'participant');
    await list.open();
    await expect(list.link(recallId)).toHaveCount(0);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 5. cer.officer: verify / close, re-resolve, close recall
  await test.step('cer.officer: Close recall refused while units are open; verify and close each unit', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    await recall.open('cer', recallId);
    await expect(recall.closeRecallButton, 'Close recall disabled while units are open').toBeDisabled();
    const early = await pageApi(page, 'POST', `/recalls/${recallId}/close`, { note: 'E2E: too early' });
    expect(early.status, early.text.slice(0, 200)).toBe(409);
    expect(early.json?.detail).toMatch(/not yet closed/i);

    for (const u of [u101, u102]) {
      expect((await recall.setUnit(u.serial, 'verified', `E2E ${stamp}: remediation evidence checked`)).status()).toBe(200);
      expect((await recall.setUnit(u.serial, 'closed', `E2E ${stamp}: unit resolved`)).status()).toBe(200);
    }
  });

  await test.step('cer.officer: Re-resolve units adds the unit registered after the recall; closed outright', async () => {
    const res = await recall.reResolve();
    expect(res.status(), 're-resolve').toBe(200);
    const body = await recallBody(page, recallId);
    const late = body.affectedUnits.find(u => u.unitId === lateUnit.id);
    expect(late, 'late unit added by Re-resolve').toBeDefined();
    expect(late!.responsibleParticipantId, 'uninstalled -> owner responsible').toBe(sunvolt);
    expect(body.events.map(e => e.kind)).toContain('units_added');
    await page.reload({ waitUntil: 'commit' });
    await recall.expectRecall(recallId);
    await expect(recall.unit(lateUnit.serial)).toBeVisible({ timeout: 30_000 });
    await expect(recall.closeRecallButton, 'still disabled - the new unit is open').toBeDisabled();
    // CER may close a unit outright with a reason (no acknowledge/remediate/verify).
    expect((await recall.setUnit(lateUnit.serial, 'closed', `E2E ${stamp}: unit quarantined at warehouse, never sold`)).status()).toBe(200);
  });

  await test.step('cer.officer: the recall closes once every unit is closed', async () => {
    await page.reload({ waitUntil: 'commit' });
    await recall.expectRecall(recallId);
    await expect(recall.closeRecallButton).toBeEnabled({ timeout: 30_000 });
    const res = await recall.closeRecall(`E2E ${stamp}: all affected units remediated or quarantined`);
    expect(res.status(), 'close recall').toBe(200);
    const body = await recallBody(page, recallId);
    expect(body.status).toBe('closed');
    expect(body.counts.closed).toBe(body.counts.total);
    record({ event: 'recall.closed', status: 'closed', recallId });
    await expect(recall.field('Closed')).not.toHaveText('—', { timeout: 30_000 });
  });

  await test.step('cer.officer (clean-up): decommission the late unit so later runs resolve two units', async () => {
    await decommissionUnit(page, lateUnit.id, `E2E Phase 6 clean-up: test unit ${lateUnit.serial} taken out of recall scope`);
  });

  await signOut(page);
});

test('Phase 6: model-wide recall with Withdraw the model - withdrawn, cited in history, no new units', async ({ page }) => {
  const notes = test.info().annotations;
  await startSession(page);
  const modelNumber = `SV-P6-${stamp}`;
  let modelId = '';
  const units = { sunvolt: { id: '', serial: `SVP6-${stamp}-1` }, gridcell: { id: '', serial: `SVP6-${stamp}-2` } };

  // ---------------------------------------------------------------- setup: fresh approved model with two units
  await test.step('sunvolt.admin + cer.admin (setup): a fresh approved model with two units', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    modelId = await registerBatteryModel(page, modelNumber, `E2E Recall Battery ${stamp}`);
    await signInAsSeed(page, seedAccount('cer.admin'));
    await setModelStatus(page, modelId, 'approved', 'E2E Phase 6: model approved for recall test');
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    units.sunvolt.id = await registerUnit(page, units.sunvolt.serial, `P6A-${stamp}`, modelId);
    units.gridcell.id = await registerUnit(page, units.gridcell.serial, `P6B-${stamp}`, modelId);
    await transferUnit(page, units.gridcell.id, gridcell, 'E2E Phase 6: sold to GridCell', 'GridCell');
    notes.push({ type: 'model', description: `${modelId} ${modelNumber}; units ${units.sunvolt.id}, ${units.gridcell.id} (GridCell)` });
  });

  await signOut(page);

  // ---------------------------------------------------------------- raise with withdraw
  let recallId = '';
  const recall = new RecallPage(page);
  await test.step('cer.officer: raise a model-wide recall with Withdraw the model ticked', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    const res = await new RecallsPage(page, 'cer').raise({
      modelId, severity: 'critical', withdrawModel: true,
      title: `E2E P6 ${stamp}: model-wide recall and withdrawal`,
      description: 'Design fault affecting every unit of this model; no further units may be registered.',
      remedy: 'Disconnect each unit and return it to the manufacturer for replacement.',
    });
    expect(res.status(), `raise: ${(await res.text()).slice(0, 300)}`).toBe(201);
    recallId = (await res.json()).id;
    notes.push({ type: 'recall', description: recallId });
    record({ event: 'recall.raised', status: 'open', recallId, modelId, withdrawModel: true });

    const body = await recallBody(page, recallId);
    expect(body.modelStatus, 'model withdrawn in the same transaction').toBe('withdrawn');
    expect(body.batches ?? [], 'model-wide (no batch scope)').toHaveLength(0);
    expect(body.events.map(e => e.kind)).toContain('model_withdrawn');
    const captured = Object.fromEntries(body.affectedUnits.map(u => [u.unitId, u]));
    expect(Object.keys(captured).sort()).toEqual([units.sunvolt.id, units.gridcell.id].sort());
    expect(captured[units.sunvolt.id].responsibleParticipantId, 'uninstalled -> owner responsible').toBe(sunvolt);
    expect(captured[units.gridcell.id].responsibleParticipantId, 'GridCell owner responsible').toBe(gridcell);
    await recall.open('cer', recallId);
    await expect(recall.field('Model')).toContainText('withdrawn');
  });

  await test.step('cer.officer: model shows withdrawn with a history version citing the recall', async () => {
    await page.goto(`${process.env.BASE_URL}/cer/register/models/${modelId}`, { waitUntil: 'commit' });
    await expect(new ModelReviewPage(page).status('withdrawn')).toBeVisible({ timeout: 30_000 });
    const history = new HistoryPanel(page);
    await history.open();
    const rows = await history.rows();
    notes.push({ type: 'model history', description: rows.map(r => r.text).join(' || ').slice(0, 800) });
    expect(rows.some(r => /withdrawn/i.test(r.text) && r.text.includes(recallId)), 'a withdrawn version cites the recall id').toBe(true);
  });

  await signOut(page);

  await test.step('sunvolt.admin: no further units of the withdrawn model can be registered', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    const res = await pageApi(page, 'POST', '/devices/units', { modelId, serial: `SVP6-${stamp}-X`, batch: `P6X-${stamp}`, attributes: { usable_capacity_kwh: 9.6 } });
    expect(res.status, `register against withdrawn model refused: ${res.text.slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    notes.push({ type: 'refused unit', description: `${res.status} ${res.text.slice(0, 200)}` });
  });

  await signOut(page);

  await test.step('gridcell.admin: as owner of one unit, sees the recall and only that unit', async () => {
    await signInAsSeed(page, seedAccount('gridcell.admin'));
    await recall.open('participant', recallId);
    await expect(recall.unit(units.gridcell.serial)).toBeVisible();
    await expect(recall.unit(units.sunvolt.serial), 'SunVolt-owned unit hidden from GridCell').toHaveCount(0);
    const body = await recallBody(page, recallId);
    expect(body.affectedUnits.map(u => u.unitId)).toEqual([units.gridcell.id]);
  });

  await signOut(page);

  await test.step('cer.officer: closes each unit outright, then the recall', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    await recall.open('cer', recallId);
    for (const u of [units.sunvolt, units.gridcell]) {
      expect((await recall.setUnit(u.serial, 'closed', `E2E ${stamp}: unit returned to manufacturer`)).status()).toBe(200);
    }
    await page.reload({ waitUntil: 'commit' });
    await recall.expectRecall(recallId);
    const res = await recall.closeRecall(`E2E ${stamp}: all units returned; model remains withdrawn`);
    expect(res.status(), 'close recall').toBe(200);
    const body = await recallBody(page, recallId);
    expect(body.status).toBe('closed');
    expect(body.modelStatus, 'model stays withdrawn after the recall closes').toBe('withdrawn');
    record({ event: 'recall.closed', status: 'closed', recallId });
  });

  await signOut(page);
});
