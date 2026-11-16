import { Page, expect, test } from '@playwright/test';
import { DeadLetterPage, ExchangePage, HistoryPanel, OutboxMessagePage, ReconciliationRunPage, UnitPage } from '../../pages';
import { SEED, seedAccount, signInAsSeed } from '../../utils/seed-accounts';
import { signOut, startSession } from '../../utils/session';
import { pageApi } from '../../utils/page-api';
import { reportIssue } from '../../utils/issues';
import { record } from '../../utils/ledger';
import { registerUnit } from '../../utils/register-setup';
import { MOCK_PARTNERS_MISSING, MockPartners, mockPartnersAvailable } from '../../utils/mock-partners';

/**
 * Phase 5 walkthrough - information exchange with AEMO, the STC registry and the network operator.
 *
 * Test 1 - runs against the public sandbox (cer.officer, sunvolt.admin):
 *   1. cer.officer    Exchange -> Interface catalogue: every interface and version, AEMO device record v1 and
 *                     v2 side by side, retry schedule 30s / 2m / 8m / 30m / 2h, dead letter + reconciliation rules.
 *   2. sunvolt.admin  (setup) registers a fresh SV-BAT-10 unit.
 *   3. cer.officer    Outbox: the unit enqueued itself once per active interface (AEMO v1, AEMO v2, STC unit v1),
 *                     delivered, with every attempt recorded. Idempotency key kind:id:versionRowId:version and
 *                     effectiveDate = the history row's valid_from; v2 adds batch, effective date, rule version and
 *                     capability attributes.
 *   4. cer.officer    A correction enqueues unit.corrected with the correcting history row's key and business date.
 *   5. cer.officer    Publish unpublished records (nothing left to queue on a populated database).
 *   6. cer.officer    Reconciliation: one run per partner interface (STC: model-record and unit-record); a run
 *                     shows its counts and differences for review.
 *
 * Test 2 - needs mock-partners (MOCK_PARTNERS_URL + PARTNER_API_KEY in .env), skipped otherwise:
 *   AEMO failNext 5 -> the delivery fails and retries on schedule (dead-lettering after the 5th failure takes
 *   ~2h40m, so it is only awaited with EXCHANGE_WAIT_DEAD_LETTER=1); inbound duplicate / late / malformed / replay
 *   dispositions, malformed fixed and replayed from Dead letters; STC claims CSV with a malformed row; snapshot
 *   tweaks -> Reconcile AEMO now -> status mismatch + missing_here ghost, each reviewed with a note.
 *   NOTE: written from the walkthrough and API contract without partner access - confirm on first run.
 *
 * Deviations from the walkthrough are soft failures + 'issue' annotations so the flow continues.
 */

const stamp = Date.now().toString(36).toUpperCase();
const unitSerial = `SVB10-X5-${stamp}`;
const batch = { registered: `E2E-${stamp}`, corrected: `E2E-${stamp}-FIX` };

const UNIT_INTERFACES = ['aemo.device-record v1', 'aemo.device-record v2', 'stc.unit-record v1'];
const V2_ONLY_FIELDS = ['batch', 'effectiveDate', 'ruleVersionApplied', 'attributes'];

test.describe.configure({ timeout: 900_000 });
test.use({ actionTimeout: 30_000 });

interface OutboxRow {
  id: number; partner: string; interfaceId: string; schemaVersion: string; eventType: string; entityId: string;
  entityVersion: number; idempotencyKey: string; status: string; attempts: number; effectiveAt: string;
  nextAttemptAt: string | null; payload?: Record<string, unknown>;
}
interface HistoryVersion { versionId: number; version: number; validFrom: string; correctionOf: number | null }

const outboxFor = async (page: Page, entityId: string): Promise<OutboxRow[]> =>
  (await pageApi(page, 'GET', `/exchange/outbox?entityId=${entityId}&limit=50`)).json?.items ?? [];

const unitHistory = async (page: Page, unitId: string): Promise<HistoryVersion[]> =>
  (await pageApi(page, 'GET', `/devices/units/${unitId}/history`)).json?.versions ?? [];

/** Waits until every unit interface has a delivered row for the given event (and history row). */
async function expectDelivered(page: Page, unitId: string, eventType: string, versionId: number): Promise<OutboxRow[]> {
  let rows: OutboxRow[] = [];
  await expect.poll(async () => {
    rows = (await outboxFor(page, unitId)).filter(r => r.eventType === eventType && r.idempotencyKey.includes(`:${versionId}:`));
    return rows.filter(r => r.status === 'delivered').map(r => `${r.interfaceId} ${r.schemaVersion}`).sort();
  }, { message: `${eventType} delivered to every unit interface`, timeout: 180_000, intervals: [5_000] }).toEqual([...UNIT_INTERFACES].sort());
  return rows;
}

/** Envelope contract for one history row: key kind:id:versionRowId:version, effectiveAt = valid_from. */
function expectEnvelope(rows: OutboxRow[], unitId: string, v: HistoryVersion) {
  for (const r of rows) {
    expect(r.idempotencyKey, `${r.interfaceId} ${r.schemaVersion} idempotency key`).toBe(`unit:${unitId}:${v.versionId}:${r.schemaVersion}`);
    expect(new Date(r.effectiveAt).toISOString(), `${r.interfaceId} ${r.schemaVersion} effective = history valid_from`).toBe(new Date(v.validFrom).toISOString());
    expect(r.entityVersion, 'entity version').toBe(v.version);
  }
}

test('Phase 5: information exchange - catalogue, outbox contract, corrections, reconciliation runs', async ({ page }) => {
  const notes = test.info().annotations;
  notes.push({ type: 'data', description: `serial=${unitSerial}` });
  await startSession(page);
  const exchange = new ExchangePage(page);

  // ---------------------------------------------------------------- 1. catalogue
  await test.step('cer.officer: Interface catalogue is the registry of versioned contracts', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    await expect(page.getByRole('banner')).toContainText('cer_officer');
    await exchange.nav.getByRole('link', { name: 'Exchange' }).click();
    await expect(exchange.main.getByRole('heading', { level: 1, name: 'Information exchange' })).toBeVisible({ timeout: 30_000 });
    await exchange.showAllRows();
    const rows = await exchange.rows();
    const catalogue = rows.map(r => `${r.Interface.split(' ')[0]} ${r.Version} ${r.Direction} ${r.Transport} ${r.Status}`);
    notes.push({ type: 'catalogue', description: catalogue.join(' | ') });
    expect(catalogue).toEqual(expect.arrayContaining([
      'aemo.device-record v1 outbound rest supported',
      'aemo.device-record v2 outbound rest current',
      'aemo.connection-updated v1 inbound event supported',
      'aemo.connection-updated v2 inbound event current',
      'stc.model-record v1 outbound rest current',
      'stc.unit-record v1 outbound rest current',
      'stc.claim-recorded v1 inbound file current',
      'network.installation-record v1 outbound rest current',
      'network.commissioning-confirmed v1 inbound event current',
    ]));
    await expect(exchange.main).toContainText('docs/interface-catalogue.md');

    const aemo = await exchange.behaviour('aemo.device-record', 'v2');
    for (const term of ['Authentication', 'Idempotency', 'Retry', 'Dead letter / replay', 'Reconciliation', 'Fields']) {
      expect(aemo[term], `behaviour: ${term}`).toBeTruthy();
    }
    expect(aemo.Retry).toMatch(/30s, 2m, 8m, 30m, 2h/);
    expect(aemo['Dead letter / replay']).toMatch(/dead-lettered/i);
    const idempotencyDocumented = /versionRowId|<kind>/i.test(aemo.Idempotency);
    expect.soft(idempotencyDocumented, `catalogue idempotency text matches the key in use: "${aemo.Idempotency}"`).toBe(true);
    if (!idempotencyDocumented) reportIssue(`Catalogue says idempotency is "${aemo.Idempotency}" but outbox keys are kind:id:versionRowId:version (e.g. unit:CER-D-…:4789170:v2)`);
  });

  await signOut(page);

  // ---------------------------------------------------------------- 2. setup: a fresh unit
  let unitId = '';
  await test.step('sunvolt.admin (setup): register a fresh SV-BAT-10 unit', async () => {
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    unitId = await registerUnit(page, unitSerial, batch.registered);
    notes.push({ type: 'unit', description: `${unitId} serial ${unitSerial}` });
  });

  await signOut(page);

  // ---------------------------------------------------------------- 3. outbox: one row per interface, delivered
  let registered: OutboxRow[] = [];
  await test.step('cer.officer: the unit enqueued itself for every active interface and was delivered', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    const [v1] = await unitHistory(page, unitId);
    expect(v1, 'registration history row').toBeDefined();
    registered = await expectDelivered(page, unitId, 'unit.registered', v1.versionId);
    expectEnvelope(registered, unitId, v1);
    notes.push({ type: 'outbox (registered)', description: registered.map(r => `#${r.id} ${r.interfaceId} ${r.schemaVersion} ${r.idempotencyKey}`).join(' | ') });

    await exchange.open('Outbox');
    const res = await exchange.search({ registerId: unitId });
    expect(res.status()).toBe(200);
    await expect(exchange.table.locator('tbody tr')).toHaveCount(3, { timeout: 30_000 });
    const rows = await exchange.rows();
    expect(rows.map(r => r['Partner / interface']).sort()).toEqual([
      'AEMO aemo.device-record v1', 'AEMO aemo.device-record v2', 'STC registry stc.unit-record v1']);
    for (const r of rows) {
      expect(r.Event).toBe('unit.registered');
      expect(r.Status).toBe('delivered');
      expect(Number(r.Attempts)).toBeGreaterThanOrEqual(1);
    }
  });

  await test.step('cer.officer: outbox message shows envelope, delivery attempts and payload; v2 adds fields', async () => {
    const v2 = registered.find(r => r.schemaVersion === 'v2')!;
    const v1 = registered.find(r => r.interfaceId === 'aemo.device-record' && r.schemaVersion === 'v1')!;
    const message = new OutboxMessagePage(page);
    await message.open(v2.id);
    await expect(message.field('Interface')).toHaveText('aemo.device-record v2');
    await expect(message.field('Event')).toHaveText('unit.registered');
    await expect(message.field('Idempotency key')).toHaveText(v2.idempotencyKey);
    const attempts = await message.attemptRows();
    expect(attempts.length, 'every attempt recorded').toBe(v2.attempts);
    expect(attempts.at(-1)!.Outcome).toBe('success');
    expect(attempts.at(-1)!.HTTP).toMatch(/^2\d\d$/);
    await expect(message.main).toContainText(batch.registered); // payload as sent (v2 carries batch)

    const p1 = (await pageApi(page, 'GET', `/exchange/outbox/${v1.id}`)).json.payload;
    const p2 = (await pageApi(page, 'GET', `/exchange/outbox/${v2.id}`)).json.payload;
    for (const f of V2_ONLY_FIELDS) {
      expect(p2, `v2 has ${f}`).toHaveProperty(f);
      expect(p1, `v1 has no ${f}`).not.toHaveProperty(f);
    }
    expect(p2.batch).toBe(batch.registered);
    expect(p1.serial).toBe(unitSerial);
  });

  // ---------------------------------------------------------------- 4. correction carries its own key and business date
  await test.step('cer.officer: a correction enqueues unit.corrected with the correcting row\'s key and date', async () => {
    const unit = new UnitPage(page);
    const history = new HistoryPanel(page);
    await page.goto(`${process.env.BASE_URL}/cer/register/units/${unitId}`, { waitUntil: 'commit' });
    await unit.expectUnit(unitSerial, unitId);
    await history.open();
    const [latest] = await history.rows();
    const res = await history.correct({ rowId: latest.rowId, field: 'batch', value: batch.corrected, reason: 'E2E Phase 5: batch label corrected for exchange test' });
    expect(res?.ok(), `correction POST ${res?.status()}`).toBe(true);
    record({ event: 'unit.corrected', status: 'registered', deviceId: unitId, serialNumber: unitSerial, participant: 'SunVolt' });

    const fix = (await unitHistory(page, unitId)).find(v => v.correctionOf === latest.rowId);
    expect(fix, `history row correcting #${latest.rowId}`).toBeDefined();
    const corrected = await expectDelivered(page, unitId, 'unit.corrected', fix!.versionId);
    expectEnvelope(corrected, unitId, fix!);
    const v2 = corrected.find(r => r.schemaVersion === 'v2')!;
    expect((await pageApi(page, 'GET', `/exchange/outbox/${v2.id}`)).json.payload.batch).toBe(batch.corrected);
    notes.push({ type: 'outbox (corrected)', description: corrected.map(r => `#${r.id} ${r.idempotencyKey} effective ${r.effectiveAt}`).join(' | ') });
  });

  // ---------------------------------------------------------------- 5. publish unpublished
  await test.step('cer.officer: Publish unpublished records queues nothing that is already published', async () => {
    await exchange.open('Outbox');
    const before = (await outboxFor(page, unitId)).length;
    const res = await exchange.publishUnpublishedRecords();
    const body = await res.text().catch(() => '');
    notes.push({ type: 'publish unpublished', description: `${res.status()} ${body.slice(0, 300)}` });
    // Meant for a fresh database; on cerpoc (≈1.6M simulated records) the scan can outlast the gateway.
    expect.soft(res.status(), 'publish-unpublished').toBe(201);
    if (res.status() !== 201) reportIssue(`Publish unpublished records returned ${res.status()} (${body.replace(/\s+/g, ' ').slice(0, 120)}) - likely the scan of the large simulated register timing out at the gateway`);
    expect((await outboxFor(page, unitId)).length, 'already-published unit is not queued again').toBe(before);
  });

  // ---------------------------------------------------------------- 6. reconciliation runs
  await test.step('cer.officer: each partner interface reconciles as its own run; a run lists differences for review', async () => {
    const runs: { id: number; partner: string; interfaceId: string; status: string }[] =
      (await pageApi(page, 'GET', '/exchange/reconciliation?limit=100')).json.items;
    const interfaces = new Set(runs.map(r => r.interfaceId));
    notes.push({ type: 'reconciliation interfaces', description: [...interfaces].join(', ') });
    for (const i of ['aemo.device-record', 'stc.model-record', 'stc.unit-record', 'network.installation-record']) {
      expect.soft(interfaces.has(i), `a reconciliation run exists for ${i}`).toBe(true);
    }

    await exchange.open('Reconciliation');
    for (const p of ['AEMO', 'STC registry', 'Network operator'] as const) {
      await expect(exchange.main.getByRole('button', { name: `Reconcile ${p} now` })).toBeVisible();
    }
    const aemo = runs.find(r => r.partner === 'aemo' && r.status === 'completed');
    expect(aemo, 'a completed AEMO run').toBeDefined();
    await exchange.table.getByRole('link', { name: String(aemo!.id), exact: true }).click();
    const run = new ReconciliationRunPage(page);
    await expect(run.main.getByRole('heading', { level: 1, name: new RegExp(`^Reconciliation run ${aemo!.id} — AEMO`) })).toBeVisible({ timeout: 30_000 });
    await expect(run.field('Interface')).toHaveText('aemo.device-record');
    for (const f of ['Register records', 'Partner records', 'Matched', 'Differences']) await expect(run.field(f)).toHaveText(/^\d+$/);
    await expect(run.reviewFilter.locator('option:checked')).toHaveText('Unreviewed only');
    await expect(run.main.getByRole('button', { name: 'Accept' }).first(), 'differences offer review actions').toBeVisible();
  });

  await signOut(page);
});

test('Phase 5: fault injection - retries, inbound faults, STC file, reconciliation review (mock-partners)', async ({ page, request }) => {
  test.skip(!mockPartnersAvailable(), MOCK_PARTNERS_MISSING);
  const partners = new MockPartners(request);
  expect(await partners.health(), 'mock-partners /health').toBe(true);
  const notes = test.info().annotations;
  await startSession(page);
  const exchange = new ExchangePage(page);

  // ---------------------------------------------------------------- outbound retries -> dead letter
  let failingUnit = '';
  await test.step('AEMO fails the next 5 deliveries; sunvolt.admin registers a unit', async () => {
    await partners.failNextAemo(5);
    await signInAsSeed(page, seedAccount('sunvolt.admin'));
    failingUnit = await registerUnit(page, `SVB10-X5F-${stamp}`, batch.registered);
    notes.push({ type: 'failing unit', description: failingUnit });
  });

  await signOut(page);

  await test.step('cer.officer: the AEMO rows fail and retry on schedule; STC is unaffected', async () => {
    await signInAsSeed(page, seedAccount('cer.officer'));
    const aemoRows = async () => (await outboxFor(page, failingUnit)).filter(r => r.partner === 'aemo');
    await expect.poll(async () => (await aemoRows()).map(r => `${r.status}:${r.attempts}`),
      { message: 'AEMO rows failed once and wait for a retry', timeout: 180_000, intervals: [5_000] })
      .toEqual(expect.arrayContaining(['failed:1']));
    const failed = (await aemoRows()).find(r => r.status === 'failed')!;
    const message = new OutboxMessagePage(page);
    await message.open(failed.id);
    await expect(message.field('Last error')).not.toHaveText('—');
    const first = (await message.attemptRows())[0];
    expect(first.Outcome).not.toBe('success');
    // Second attempt is due ~30s after the first.
    const wait = new Date(failed.nextAttemptAt!).getTime() - new Date((await pageApi(page, 'GET', `/exchange/outbox/${failed.id}`)).json.deliveries[0].attemptedAt).getTime();
    expect(wait, 'first retry ~30s later').toBeGreaterThanOrEqual(25_000);
    expect(wait).toBeLessThanOrEqual(60_000);
    const stc = (await outboxFor(page, failingUnit)).filter(r => r.partner === 'stc');
    await expect.poll(async () => (await outboxFor(page, failingUnit)).filter(r => r.partner === 'stc').every(r => r.status === 'delivered'),
      { timeout: 120_000 }).toBe(true);
    notes.push({ type: 'retry', description: `#${failed.id} next attempt after ${Math.round(wait / 1000)}s; STC rows ${stc.map(r => r.id).join(',')}` });
  });

  await test.step('cer.officer: after the 5th failure the message is a dead letter - discarded with a note', async () => {
    test.skip(process.env.EXCHANGE_WAIT_DEAD_LETTER !== '1', 'Dead-lettering takes ~2h40m (30s + 2m + 8m + 30m + 2h) - set EXCHANGE_WAIT_DEAD_LETTER=1 to wait for it');
    test.setTimeout(4 * 60 * 60_000);
    let dead: { id: number; outboxId: number } | undefined;
    await expect.poll(async () => {
      const ids = new Set((await outboxFor(page, failingUnit)).filter(r => r.partner === 'aemo').map(r => r.id));
      dead = ((await pageApi(page, 'GET', '/exchange/dead-letters?partner=aemo&status=open&limit=100')).json?.items ?? []).find((d: any) => ids.has(d.outboxId));
      return !!dead;
    }, { timeout: 3 * 60 * 60_000, intervals: [60_000] }).toBe(true);
    const letter = new DeadLetterPage(page);
    await letter.open(dead!.id);
    const res = await letter.discard(`E2E ${stamp}: AEMO outage simulated - discarded`);
    expect(res.status()).toBe(200);
  });

  // ---------------------------------------------------------------- inbound faults
  await test.step('AEMO emits der.connection.updated with each fault; Inbox shows the disposition', async () => {
    const payload = { nmi: '4001234567', deviceId: SEED.units.svb10_000101.id, status: 'registered', registeredOn: new Date().toISOString().slice(0, 10) };
    for (const fault of ['duplicate', 'late', 'replay', 'malformed'] as const) await partners.emitAemo('der.connection.updated', payload, fault);
    await exchange.open('Inbox');
    for (const disposition of ['duplicate', 'late', 'replayed', 'malformed']) {
      await expect.poll(async () => {
        const res = await exchange.search({ partner: 'AEMO', disposition });
        return ((await res.json()).items ?? []).length;
      }, { message: `inbox has a ${disposition} AEMO message`, timeout: 120_000, intervals: [5_000] }).toBeGreaterThan(0);
    }
  });

  await test.step('cer.officer: the malformed message is a dead letter - payload fixed and replayed once', async () => {
    const letters = (await pageApi(page, 'GET', '/exchange/dead-letters?partner=aemo&status=open&limit=20')).json.items;
    const malformed = letters.find((d: any) => d.direction === 'inbound');
    expect(malformed, 'inbound AEMO dead letter').toBeDefined();
    const letter = new DeadLetterPage(page);
    await letter.open(malformed.id);
    const fixed = { ...(typeof malformed.payload === 'object' ? malformed.payload : {}), nmi: '4001234567', deviceId: SEED.units.svb10_000101.id, status: 'registered' };
    const res = await letter.replay(`E2E ${stamp}: payload corrected and replayed`, fixed);
    expect(res.status(), `replay: ${(await res.text()).slice(0, 300)}`).toBe(200);
    const after = (await pageApi(page, 'GET', `/exchange/dead-letters/${malformed.id}`)).json;
    expect(after.status).toBe('replayed');
    const again = await pageApi(page, 'POST', `/exchange/dead-letters/${malformed.id}/replay`, { note: 'second replay must be refused' });
    expect(again.status, 'a dead letter is replayed only once').toBe(409);
  });

  // ---------------------------------------------------------------- STC claims file
  await test.step('STC claims CSV with a malformed row: good rows apply, bad row dead-lettered, never ingested twice', async () => {
    const file = await partners.generateStcFile([{ deviceId: SEED.units.svb10_000101.id, serial: SEED.units.svb10_000101.serial }], true);
    notes.push({ type: 'stc file', description: file.text.slice(0, 300) });
    await expect.poll(async () =>
      ((await pageApi(page, 'GET', `/exchange/inbox?partner=stc&entityId=${SEED.units.svb10_000101.id}&limit=20`)).json?.items ?? [])
        .some((m: any) => m.disposition === 'applied'),
    { message: 'a claim row applied', timeout: 180_000, intervals: [10_000] }).toBe(true);
    const stcDead = (await pageApi(page, 'GET', '/exchange/dead-letters?partner=stc&status=open&limit=20')).json.items;
    expect(stcDead.length, 'malformed CSV row dead-lettered').toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- reconciliation review
  await test.step('AEMO snapshot tweaked; Reconcile AEMO now lists a status mismatch and a missing_here ghost; each reviewed', async () => {
    await partners.tweakAemoSnapshot([{ id: SEED.units.svb10_000101.id, set: { status: 'active' } }, { id: 'CER-D-GHOST', add: {} }]);
    await exchange.open('Reconciliation');
    const res = await exchange.reconcileNow('AEMO');
    expect(res.status()).toBe(201);
    const runId: number = (await res.json()).id;
    notes.push({ type: 'reconciliation run', description: String(runId) });
    const timeout = Number(process.env.EXCHANGE_RECONCILE_TIMEOUT_MS ?? 90 * 60_000);
    test.setTimeout(timeout + 30 * 60_000);
    await expect.poll(async () => (await pageApi(page, 'GET', `/exchange/reconciliation/${runId}`)).json?.status,
      { message: `run ${runId} completes`, timeout, intervals: [30_000] }).toBe('completed');

    const diffs = async () => ((await pageApi(page, 'GET', `/exchange/reconciliation/${runId}/differences?review=all&limit=500`)).json?.items ?? []) as any[];
    const all = await diffs();
    const mismatch = all.find(d => d.entityId === SEED.units.svb10_000101.id && d.disposition === 'mismatch');
    const ghost = all.find(d => d.entityId === 'CER-D-GHOST' && d.disposition === 'missing_here');
    expect(mismatch, 'status mismatch on the tweaked unit').toBeDefined();
    expect(mismatch.fields).toContain('status');
    expect(ghost, 'missing_here ghost').toBeDefined();

    const run = new ReconciliationRunPage(page);
    await run.open(runId);
    expect((await run.review(SEED.units.svb10_000101.id, 'accepted', `E2E ${stamp}: AEMO status lags the register`)).status()).toBe(200);
    expect((await run.review('CER-D-GHOST', 'dismissed', `E2E ${stamp}: injected ghost record`)).status()).toBe(200);
    const reviewed = await diffs();
    expect(reviewed.find(d => d.id === mismatch.id)?.reviewStatus).toBe('accepted');
    expect(reviewed.find(d => d.id === ghost.id)?.reviewStatus).toBe('dismissed');
    expect((await pageApi(page, 'GET', `/devices/units/${SEED.units.svb10_000101.id}`)).json.status, 'reconciliation never changes the register').toBe('installed');
  });

  await signOut(page);
});
