import { Page, expect, test } from '@playwright/test';
import { HistoryPanel, UnitPage } from '../../pages';
import { seedAccount, signInAsSeed } from '../../utils/seed-accounts';
import { signOut, startSession } from '../../utils/session';
import { reportIssue } from '../../utils/issues';
import { record } from '../../utils/ledger';

/**
 * Phase 3 walkthrough - device history and corrections (history.device_versions: append-only,
 * valid_to derived, a correction appends a row superseding the one it references, at most once).
 *
 *   1. cer.officer    Seeded evidence unit SVB5-25-000001: History registered (SunVolt, Mar 2025) ->
 *                     installed NMI 4009876543 (GridCell, Apr 2025) -> sold to GridCell (Sept 2025) ->
 *                     removed -> decommissioned (July 2026); version ordinal and row id shown separately.
 *   2. cer.officer    Reconstruct: as of 2026-06-20 known at 2026-07-05 -> installed, site active;
 *                     known at blank -> decommissioned (corrected on 10 July to 15 June).
 *                     Installation History: original row "superseded by", correcting row "corrects #".
 *   3. sunvolt.admin  (setup) registers a fresh SV-BAT-10 unit; as owning participant_admin transfers it
 *                     to GridCell; has no "Correct a version".
 *   4. cer.officer    Transfers it back (CER transfer); prior owner stays in history.
 *                     Corrections: reason < 10 chars refused; earlier version -> history only;
 *                     latest version -> current record too; a superseded row can't be corrected again.
 *
 * The seeded unit/installation are only read (corrections are permanent and once per row), so every
 * write happens on the unit this run registers. Deviations are soft failures + 'issue' annotations.
 */

const SEED_UNIT = { serial: 'SVB5-25-000001', id: 'CER-D-0000000000000000000SVBAT5A' };
const SEED_INSTALLATION = 'CER-I-000000000000000000GCNMI004';
const SV_BAT_10 = 'CER-M-0000000000000000000SVBAT10';
const GRIDCELL_ID = 'CER-P-01J000000000000000GRIDCELL';

const stamp = Date.now().toString(36).toUpperCase();
const unitSerial = `SVB10-H-${stamp}`;
const batch = { registered: `E2E-${stamp}`, earlier: `E2E-${stamp}-HIST`, latest: `E2E-${stamp}-FIX` };

test.describe.configure({ timeout: 600_000 });
test.use({ actionTimeout: 30_000 }); // fail fast instead of waiting out the 10-minute test timeout

const base = () => process.env.BASE_URL!;

async function api(page: Page, method: string, path: string, body?: object): Promise<{ status: number; text: string }> {
  return page.evaluate(async ({ method, path, body }) => {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('regigov.accessToken')}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, text: await r.text() };
  }, { method, path, body });
}

/** As-of reconstruction: soft-checks the result; a server error is reported once and the checks skipped. */
let reconstructionDown = false;
async function expectReconstruction(history: HistoryPanel, asOf: string, knownAt: string, expected: RegExp[], what: string) {
  if (reconstructionDown) { expect.soft(reconstructionDown, `${what}: skipped, reconstruction endpoint is failing`).toBe(false); return; }
  const { status, text } = await history.reconstruct(asOf, knownAt);
  test.info().annotations.push({ type: `as of ${asOf} known ${knownAt || 'now'}`, description: `${status} ${text.slice(0, 300)}` });
  expect.soft(status, `${what}: GET .../at succeeds`).toBe(200);
  if (status !== 200) {
    reconstructionDown = status >= 500;
    reportIssue(`As-of reconstruction (${what}) failed: GET .../at returned ${status}; the panel stays on "Loading…"`);
    return;
  }
  for (const re of expected) expect.soft(text, what).toMatch(re);
}

test('Phase 3: device history - versions, as-of reconstruction, corrections, transfer', async ({ page }) => {
  const notes = test.info().annotations;
  notes.push({ type: 'data', description: `serial=${unitSerial}` });
  await startSession(page);
  const history = new HistoryPanel(page);
  const unit = new UnitPage(page);

  // ---------------------------------------------------------------- 1. seeded evidence unit history
  await test.step('cer.officer: SVB5-25-000001 history reads as its life story', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    await expect(page.getByRole('banner')).toContainText('cer_officer');
    await page.goto(`${base()}/cer/register?tab=units`, { waitUntil: 'commit' });
    const main = page.getByRole('main');
    await main.getByRole('searchbox', { name: 'Search', exact: true }).fill(SEED_UNIT.serial);
    await main.getByRole('button', { name: 'Search', exact: true }).click();
    const unitLink = main.getByRole('link', { name: SEED_UNIT.serial, exact: true });
    await expect(unitLink).toBeVisible({ timeout: 90_000 }); // the sandbox search can be slow
    await unitLink.click();
    await unit.expectUnit(SEED_UNIT.serial, SEED_UNIT.id);

    await history.open();
    const rows = await history.rows();
    notes.push({ type: 'seed unit history', description: rows.map(r => `${r.version} #${r.rowId}`).join(', ') });
    const life = [...rows].reverse(); // oldest first
    const story: [RegExp, string][] = [
      [/REGISTERED.*Mar 2025.*SunVolt.*Registered by manufacturer/i, 'registered by SunVolt (Mar 2025)'],
      [/INSTALLED.*Apr 2025.*GridCell.*Installed at NMI 4009876543/i, 'installed at NMI 4009876543 by GridCell (Apr 2025)'],
      [/Sept 2025.*Sold to GridCell/i, 'sold to GridCell (Sept 2025)'],
      [/Removed from NMI 4009876543/i, 'removed'],
      [/DECOMMISSIONED.*July 2026/i, 'decommissioned (July 2026)'],
    ];
    expect(life.length, 'five versions').toBe(story.length);
    story.forEach(([re, label], i) => expect.soft(life[i].text, `v${i + 1}: ${label}`).toMatch(re));
    life.forEach((r, i) => expect(r.version, 'ordinals v1..v5').toBe(`v${i + 1}`));
    expect.soft(life[2].rowId, 'v3 is row #10 (version and row id differ)').toBe(10);
    for (const r of rows) expect(String(r.rowId), `${r.version} has its own row id`).not.toBe(r.version.slice(1));
  });

  // ---------------------------------------------------------------- 2. as-of reconstruction + installation history
  await test.step('cer.officer: reconstruct the unit at a point in time', async () => {
    await expectReconstruction(history, '2026-06-20T12:00', '2026-07-05T12:00', [/installed/i, /active/i],
      'as of 2026-06-20 known at 2026-07-05: installed, site active');
    await expectReconstruction(history, '2026-06-20T12:00', '', [/decommissioned/i],
      'as of 2026-06-20 known now: site already decommissioned (corrected to 15 June)');
    await expectReconstruction(history, '2025-06-01T12:00', '', [/SunVolt/i],
      'as of 2025-06-01: prior owner SunVolt');
  });

  await test.step('cer.officer: installation history - original superseded, correction references it', async () => {
    await page.goto(`${base()}/cer/register/installations/${SEED_INSTALLATION}`, { waitUntil: 'commit' });
    await expect(page.getByRole('main')).toContainText('NMI 4009876543', { timeout: 30_000 });
    await expect(page.getByRole('main').locator('dt:text-is("Decommissioned on") + dd')).toHaveText('2026-06-15');
    await history.open();
    const rows = await history.rows();
    notes.push({ type: 'seed installation history', description: rows.map(r => r.text).join(' || ').slice(0, 800) });
    const correction = rows.find(r => r.corrects !== undefined);
    expect(correction, 'a correcting row').toBeDefined();
    expect(correction!.text).toMatch(/10 July 2026/);
    expect(correction!.text).toMatch(/2026-06-30 to 2026-06-15/);
    const original = rows.find(r => r.rowId === correction!.corrects)!;
    expect(original, `corrected row #${correction!.corrects}`).toBeDefined();
    expect(original.supersededBy, 'original shows "superseded by"').toBe(correction!.rowId);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 3. sunvolt.admin: own unit, participant transfer
  let unitId = '';
  let sunvoltId = '';
  let currentBatch = batch.registered;
  await test.step('sunvolt.admin (setup): register a fresh SV-BAT-10 unit', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    await expect(page.getByRole('banner')).toContainText('participant_admin');
    // Phase 2 found the participant Register unit model list empty, so the setup unit goes through the API.
    const res = await api(page, 'POST', '/api/devices/units',
      { modelId: SV_BAT_10, serial: unitSerial, batch: batch.registered, attributes: { usable_capacity_kwh: 9.6 } });
    expect(res.status, `POST /api/devices/units: ${res.text.slice(0, 300)}`).toBe(201);
    unitId = res.text.match(/CER-D-[0-9A-Z]+/)![0];
    sunvoltId = (res.text.match(/"ownerParticipantId"\s*:\s*"(CER-P-[0-9A-Z]+)"/) ?? [])[1] ?? '';
    expect(sunvoltId, 'owner participant id in response').toMatch(/^CER-P-/);
    record({ event: 'unit.acquired', status: 'registered', deviceId: unitId, modelId: SV_BAT_10, serialNumber: unitSerial, participant: 'SunVolt' });
    notes.push({ type: 'unit', description: `${unitId} serial ${unitSerial}, owner ${sunvoltId}` });
  });

  await test.step('sunvolt.admin: owning participant_admin transfers the unit to GridCell; no corrections', async () => {
    await page.goto(`${base()}/participant/devices/units/${unitId}`, { waitUntil: 'commit' });
    await unit.expectUnit(unitSerial, unitId);
    await history.open();
    await expect(history.panel.getByText('Correct a version')).toHaveCount(0);
    await unit.transferTo(GRIDCELL_ID, 'E2E Phase 3: sold to GridCell for fleet use');
    await expect(unit.field('Owner')).toContainText('GridCell', { timeout: 60_000 });
    record({ event: 'unit.transferred', status: 'registered', deviceId: unitId, serialNumber: unitSerial, participant: 'GridCell' });
  });

  await signOut(page);

  // ---------------------------------------------------------------- 4. cer.officer: CER transfer + corrections
  await test.step('cer.officer: transfers it back to SunVolt; prior owner remains in history', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    await page.goto(`${base()}/cer/register/units/${unitId}`, { waitUntil: 'commit' });
    await unit.expectUnit(unitSerial, unitId);
    await expect(unit.field('Owner')).toContainText('GridCell');
    const reason = 'E2E Phase 3: returned to manufacturer under warranty';
    const viaUi = await unit.transferTo(sunvoltId, reason, /SunVolt/);
    expect.soft(viaUi, 'CER Transfer "New owner" list offers SunVolt').toBe(true);
    if (!viaUi) {
      reportIssue('CER Transfer ownership: "New owner" list is cut off alphabetically (ends at "F…") - SunVolt/GridCell not offered; transferred via POST /api/devices/units/{id}/transfer instead');
      const res = await api(page, 'POST', `/api/devices/units/${unitId}/transfer`,
        { newOwnerParticipantId: sunvoltId, changeReason: reason, evidenceRef: `E2E-${stamp}` });
      expect(res.status, `POST transfer: ${res.text.slice(0, 300)}`).toBeLessThan(300);
      await page.reload({ waitUntil: 'commit' });
    }
    await expect(unit.field('Owner')).toContainText('SunVolt', { timeout: 60_000 });
    record({ event: 'unit.transferred', status: 'registered', deviceId: unitId, serialNumber: unitSerial, participant: 'SunVolt' });
    await page.reload({ waitUntil: 'commit' });
    await history.open();
    const rows = await history.rows();
    notes.push({ type: 'unit history after transfers', description: rows.map(r => r.text).join(' || ').slice(0, 900) });
    expect(rows.length, 'registered + two transfers').toBe(3);
    await expect(history.table, 'transfer rows record the ownership change').toContainText('ownerParticipantId');
    await expect(history.table, 'prior owner GridCell still visible').toContainText('GridCell');
    await expect(history.table).toContainText('returned to manufacturer under warranty');
  });

  await test.step('cer.officer: correction reason shorter than 10 characters is refused', async () => {
    const latest = (await history.rows())[0];
    const res = await history.correct({ rowId: latest.rowId, field: 'batch', value: `${batch.registered}-X`, reason: 'too short' });
    const accepted = !!res && res.ok();
    if (accepted) currentBatch = `${batch.registered}-X`; // the refused-in-theory correction did land on the latest version
    expect.soft(accepted, 'correction with a 9-character reason is refused').toBe(false);
    if (accepted) reportIssue(`Correction with a 9-character reason was accepted (${res!.status()}) - walkthrough requires ≥ 10`);
    notes.push({ type: 'short reason', description: res ? `${res.status()} ${(await res.text()).slice(0, 200)}` : 'not sent (browser validation)' });
    await page.reload({ waitUntil: 'commit' });
    await history.open();
  });

  await test.step('cer.officer: correcting an earlier version changes history only', async () => {
    const rows = await history.rows();
    const earliest = rows[rows.length - 1];
    const res = await history.correct({
      rowId: earliest.rowId, field: 'batch', value: batch.earlier,
      reason: 'E2E Phase 3: batch label misread at registration', evidence: `E2E-EV-${stamp}`,
    });
    expect(res?.ok(), `correction POST ${res?.status()}`).toBe(true);
    await page.reload({ waitUntil: 'commit' });
    await history.open();
    const after = await history.rows();
    const fix = after.find(r => r.corrects === earliest.rowId);
    expect(fix, `row correcting #${earliest.rowId}`).toBeDefined();
    expect(fix!.text).toContain(`E2E-EV-${stamp}`);
    expect(after.find(r => r.rowId === earliest.rowId)!.supersededBy, 'original shows superseded by').toBe(fix!.rowId);
    await expect(unit.field('Batch'), 'current record unchanged').toHaveText(currentBatch);
    expect.soft(await history.correctableRowIds(), 'a superseded row cannot be corrected again').not.toContain(earliest.rowId);
    notes.push({ type: 'earlier correction', description: `#${fix!.rowId} corrects #${earliest.rowId}` });
  });

  await test.step('cer.officer: correcting the latest version also updates the current record', async () => {
    const rows = await history.rows();
    const latest = rows.find(r => r.supersededBy === undefined && /current/.test(r.text))!;
    expect(latest, 'current version row').toBeDefined();
    const res = await history.correct({
      rowId: latest.rowId, field: 'batch', value: batch.latest,
      reason: 'E2E Phase 3: batch relabelled after warranty return',
    });
    expect(res?.ok(), `correction POST ${res?.status()}`).toBe(true);
    await page.reload({ waitUntil: 'commit' });
    await expect(unit.field('Batch'), 'current record updated').toHaveText(batch.latest, { timeout: 30_000 });
    await history.open();
    const after = await history.rows();
    const fix = after.find(r => r.corrects === latest.rowId);
    expect(fix, `row correcting #${latest.rowId}`).toBeDefined();
    expect(after.find(r => r.rowId === latest.rowId)!.supersededBy).toBe(fix!.rowId);
    notes.push({ type: 'latest correction', description: `#${fix!.rowId} corrects #${latest.rowId}` });
    record({ event: 'unit.corrected', status: 'registered', deviceId: unitId, serialNumber: unitSerial, participant: 'SunVolt' });
  });

  await signOut(page);
});
