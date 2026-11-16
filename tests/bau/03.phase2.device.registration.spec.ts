import { Page, expect, test } from '@playwright/test';
import {
  BasePage, MyDevicesPage, RecordInstallationPage, RegisterModelPage, RegisterSectionsPage,
  RegisterUnitPage, RuleSetsPage, UnitPage,
} from '../../pages';
import { DeviceModel } from '../../dynamic.data/device-model.builder';
import { seedAccount, signInAsSeed } from '../../utils/seed-accounts';
import { signOut, startSession } from '../../utils/session';
import { reportIssue } from '../../utils/issues';
import { record } from '../../utils/ledger';

/**
 * Phase 2 walkthrough - device registration (models, units, installations under
 * effective-dated rule sets in register.device_class_rules).
 *
 *   1. cer.admin      Rule sets: battery v1 (2025-01-01) / v2 (2026-07-01, chemistry enum,
 *                     grid_connected required, duplicate key nmi), inverter v1, pv_module v1.
 *   2. cer.admin      Installation of the GridCell seed unit at NMI 4001234567 without
 *                     grid_connected -> structured reason inline.
 *   3. cer.admin      Fixed and resubmitted -> refused as duplicate (active battery installation
 *                     at that NMI). Rejected submissions show payload, reasons and rule version.
 *   4. sunvolt.admin  Registers a model (pending, CER-M-), duplicate model number refused,
 *                     registers a unit of approved SV-BAT-10 (CER-D-), transfers it to GridCell.
 *   5. gridcell.admin Sees only units it owns/manufactures/installed; installs the unit (CER-I-).
 *   6. sunvolt.user   Browses My devices but cannot register.
 *
 * All seed accounts use SANDBOX_SEED_PASSWORD. Each run creates its own model, unit and
 * installation (unique model number / serial / NMI), so the seed unit SVB10-24-000103 is
 * never installed and steps 2-3 stay repeatable.
 * Deviations from the walkthrough are soft failures + 'issue' annotations so the flow continues.
 */

const SEED_UNIT = { serial: 'SVB10-24-000103', id: 'CER-D-000000000000000000SVBAT10C' };
const DUPLICATE_NMI = '4001234567';
const SV_BAT_10 = { modelNumber: 'SV-BAT-10', id: 'CER-M-0000000000000000000SVBAT10' };
const GRIDCELL_ID = 'CER-P-01J000000000000000GRIDCELL';

const stamp = Date.now().toString(36).toUpperCase();
const newModel: DeviceModel = {
  deviceClass: 'battery',
  modelNumber: `SV-E2E-${stamp}`,
  modelName: `E2E Battery ${stamp}`,
  attributes: { chemistry: 'LFP', capacity_kwh: 10, nominal_voltage_v: 51.2 },
};
const unitSerial = `SVB10-E2E-${stamp}`;
const unitAttributes = { usable_capacity_kwh: 9.6 };
const installNmi = `6${Date.now().toString().slice(-9)}`;

test.describe.configure({ timeout: 600_000 });

async function openMyDevices(page: Page) {
  await page.goto(`${process.env.BASE_URL}/participant/devices`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { level: 1, name: 'My devices' })).toBeVisible({ timeout: 30_000 });
}

/** API fallback for unit registration, using the signed-in user's bearer token. */
async function registerUnitViaApi(page: Page, body: object): Promise<{ status: number; text: string }> {
  return page.evaluate(async b => {
    const r = await fetch('/api/devices/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('regigov.accessToken')}` },
      body: JSON.stringify(b),
    });
    return { status: r.status, text: await r.text() };
  }, body);
}

test('Phase 2: device registration - rule sets, rejections, model, unit, installation, read-only user', async ({ page }) => {
  const notes = test.info().annotations;
  notes.push({ type: 'data', description: `model=${newModel.modelNumber}, serial=${unitSerial}, nmi=${installNmi}` });
  await startSession(page);

  // ---------------------------------------------------------------- 1. cer.admin: rule sets
  await test.step('cer.admin: rule sets are effective-dated data', async () => {
    await signInAsSeed(page, seedAccount('cer.admin'));
    await expect(page.getByRole('banner')).toContainText('cer_admin');
    const rules = new RuleSetsPage(page);
    await rules.open();

    await expect(rules.versionRow('battery', 'v1')).toContainText('2025-01-01 → 2026-07-01');
    const v2 = rules.versionRow('battery', 'v2');
    await expect(v2).toContainText('2026-07-01 → open');
    await expect(v2).toContainText(/chemistry/i);
    const v2Json = await rules.definition('battery', 'v2');
    expect(v2Json, 'battery v2 restricts chemistry').toMatch(/"chemistry"[^}]*"enum"/);
    expect(v2Json, 'battery v2 requires grid_connected').toMatch(/"required"\s*:\s*\[[^\]]*"grid_connected"/);
    expect(v2Json, 'battery v2 duplicate key: nmi').toMatch(/"installation"\s*:\s*\[\s*\[\s*"nmi"\s*\]\s*\]/);
    await expect(rules.versionRow('inverter', 'v1')).toContainText('2025-01-01 → open');
    await expect(rules.versionRow('pv_module', 'v1')).toContainText('2025-01-01 → open');
    await expect(rules.main.getByRole('button', { name: /^New version from v/ }).first()).toBeVisible();
    await rules.checkNewDeviceClassForm();
  });

  // ---------------------------------------------------------------- 2-3. cer.admin: two refused installations
  const install = new RecordInstallationPage(page);
  const posted: number[] = [];
  let missingFieldPosted = 0;
  page.on('response', r => {
    if (r.request().method() === 'POST' && r.url().endsWith('/api/devices/installations')) posted.push(r.status());
  });

  await test.step('cer.admin: installation without grid_connected -> structured reason inline', async () => {
    await page.goto(`${process.env.BASE_URL}/cer/register`, { waitUntil: 'commit' });
    await install.open();
    const notice = await install.fill({ serial: SEED_UNIT.serial, nmi: DUPLICATE_NMI });
    expect(notice).toMatch(/Battery energy storage rules v2/);
    await install.submit();
    await expect(install.main.getByText('grid_connected is required.')).toBeVisible();
    await expect(install.gridConnected).toHaveAttribute('aria-invalid', 'true');
    // The walkthrough expects this attempt in Rejected submissions, which needs it to reach the server.
    await page.waitForTimeout(2_000);
    missingFieldPosted = posted.length;
    if (missingFieldPosted === 0) {
      reportIssue('Missing grid_connected is only checked in the browser - nothing is sent, so the attempt is not in Rejected submissions');
    }
  });

  await test.step('cer.admin: fixed and resubmitted -> refused as duplicate NMI', async () => {
    await install.gridConnected.selectOption({ label: 'yes' });
    await install.submit();
    const alert = install.refusal.filter({ hasText: 'Duplicate submission' });
    await expect(alert).toBeVisible({ timeout: 60_000 });
    await expect(alert).toContainText('Installation refused under Battery energy storage rules v2');
    await expect(alert).toContainText(/nmi.*already has this nmi/s);
    await expect(install.nmi).toHaveAttribute('aria-invalid', 'true');
    expect(posted.at(-1), 'duplicate refused with HTTP 409').toBe(409);
  });

  await test.step('cer.admin: both attempts listed under Rejected submissions', async () => {
    await new BasePage(page).nav.getByRole('link', { name: 'Device register' }).click();
    const register = new RegisterSectionsPage(page);
    await register.openSection('Rejected submissions');
    const newest = register.rows().first();
    await expect(newest).toContainText('installation', { timeout: 30_000 });
    await expect(newest).toContainText('battery v2');
    await expect(newest).toContainText(/already has this nmi.*\[duplicate\]/s);
    const payload = await register.payload(newest);
    expect(payload).toContain(DUPLICATE_NMI);
    expect(payload).toContain(SEED_UNIT.id);
    notes.push({ type: 'rejection (duplicate)', description: (await newest.innerText()).replace(/\s+/g, ' ').slice(0, 300) });

    expect.soft(missingFieldPosted, 'missing grid_connected attempt is submitted and recorded as a rejection').toBeGreaterThan(0);
    if (missingFieldPosted > 0) {
      await expect.soft(register.rows().nth(1), 'second-newest rejection is the missing grid_connected attempt')
        .toContainText(/grid_connected.*\[required\]/s);
    }
  });

  await signOut(page);

  // ---------------------------------------------------------------- 4. sunvolt.admin: model, unit, transfer
  let modelId = '';
  let unitId = '';
  await test.step('sunvolt.admin: register a model -> pending, CER-M- ID', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    await expect(page.getByRole('banner')).toContainText('participant_admin');
    await openMyDevices(page);
    await new MyDevicesPage(page).openRegisterModel();
    modelId = await new RegisterModelPage(page).registerModel(newModel);
    expect(modelId).toMatch(/^CER-M-/);
    record({ event: 'model.requested', status: 'pending', deviceId: modelId, deviceClass: 'battery', modelNumber: newModel.modelNumber, participant: 'SunVolt' });
    notes.push({ type: 'model', description: `${modelId} ${newModel.modelNumber} pending` });
  });

  await test.step('sunvolt.admin: same model number again -> refused as duplicate', async () => {
    await openMyDevices(page);
    const devices = new MyDevicesPage(page);
    await devices.openRegisterModel();
    const form = new RegisterModelPage(page);
    await form.deviceClass.selectOption('battery');
    await expect(form.rulesNotice).toBeVisible({ timeout: 15_000 });
    await form.modelNumber.fill(SV_BAT_10.modelNumber.toLowerCase()); // unique per manufacturer, case-insensitive
    await form.modelName.fill('Duplicate check');
    await form.classAttributes.getByLabel(/^chemistry\b/).selectOption('LFP');
    await form.classAttributes.getByLabel(/^capacity_kwh\b/).fill('10');
    await form.classAttributes.getByLabel(/^nominal_voltage_v\b/).fill('51.2');
    await form.registerButton.click();
    const refusal = form.main.getByRole('alert');
    await expect(refusal).toBeVisible({ timeout: 60_000 });
    await expect(refusal).toContainText(/duplicate|already/i);
    notes.push({ type: 'duplicate model', description: (await refusal.innerText()).replace(/\s+/g, ' ').slice(0, 300) });
  });

  await test.step('sunvolt.admin: register a unit of approved SV-BAT-10 -> CER-D- ID', async () => {
    await openMyDevices(page);
    const unitForm = new RegisterUnitPage(page);
    await unitForm.open();
    const options = await unitForm.modelOptions();
    const offered = options.some(o => o.includes(SV_BAT_10.modelNumber));
    expect.soft(offered, 'Register unit offers the approved SV-BAT-10 model').toBe(true);
    if (offered) {
      unitId = await unitForm.register(SV_BAT_10.modelNumber, unitSerial, unitAttributes);
    } else {
      reportIssue(`Participant Register unit: Model list is empty (${options.length} options) - unit registered via POST /api/devices/units instead`);
      const res = await registerUnitViaApi(page, { modelId: SV_BAT_10.id, serial: unitSerial, batch: `E2E-${stamp}`, attributes: unitAttributes });
      expect(res.status, `POST /api/devices/units: ${res.text.slice(0, 300)}`).toBe(201);
      unitId = res.text.match(/CER-D-[0-9A-Z]+/)![0];
      await page.goto(`${process.env.BASE_URL}/participant/devices/units/${unitId}`, { waitUntil: 'commit' });
    }
    expect(unitId).toMatch(/^CER-D-/);
    const unit = new UnitPage(page);
    await unit.expectUnit(unitSerial, unitId);
    await expect(unit.field('Model')).toContainText(SV_BAT_10.modelNumber);
    await expect(unit.field('Rules applied')).toContainText('battery v2');
    record({ event: 'unit.acquired', status: 'registered', deviceId: unitId, modelId: SV_BAT_10.id, serialNumber: unitSerial, participant: 'SunVolt' });
    notes.push({ type: 'unit', description: `${unitId} serial ${unitSerial}` });
  });

  await test.step('sunvolt.admin: transfer the unit to GridCell', async () => {
    const unit = new UnitPage(page);
    await unit.transferTo(GRIDCELL_ID, 'E2E Phase 2: sold to installer');
    await expect(unit.field('Owner')).toContainText('GridCell', { timeout: 60_000 });
  });

  await signOut(page);

  // ---------------------------------------------------------------- 5. gridcell.admin: installation
  await test.step('gridcell.admin: records an installation of a unit it owns -> CER-I- ID', async () => {
    await signInAsSeed(page, seedAccount('gridcell.admin'));
    await openMyDevices(page);
    await expect(page.getByText('Only records owned, manufactured or installed by your organisation are shown.')).toBeVisible();
    await install.open();
    const options = await install.unitOptions();
    notes.push({ type: 'installable units (gridcell)', description: options.join(' | ') });
    expect(options.some(o => o.includes(unitSerial)), 'transferred unit is offered').toBe(true);
    for (const o of options) expect.soft(o, 'only GridCell units are offered').toMatch(/GridCell/);

    const notice = await install.fill({ serial: unitSerial, nmi: installNmi, gridConnected: true });
    expect(notice).toMatch(/Battery energy storage rules v2/);
    const installationId = await install.submitExpectRecorded();
    await expect(install.main).toContainText(installNmi);
    record({ event: 'unit.installed', status: 'active', deviceId: unitId, installationId, serialNumber: unitSerial, nmi: installNmi, participant: 'GridCell' });
    notes.push({ type: 'installation', description: `${installationId} unit ${unitId} at NMI ${installNmi}` });
  });

  await signOut(page);

  // ---------------------------------------------------------------- 6. sunvolt.user: read-only
  await test.step('sunvolt.user: can browse My devices but not register', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.user'));
    await expect(page.getByRole('banner')).toContainText('participant_user');
    await openMyDevices(page);
    const devices = new MyDevicesPage(page);
    const register = new RegisterSectionsPage(page);
    await register.openSection('Models');
    await expect(register.rows().filter({ hasText: SV_BAT_10.modelNumber }).first()).toBeVisible({ timeout: 30_000 });
    await expect(devices.registerModelLink).toHaveCount(0);
    await expect(devices.registerUnitLink).toHaveCount(0);
    await expect(devices.recordInstallationLink).toHaveCount(0);
  });

  await signOut(page);
});
