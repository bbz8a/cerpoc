import { test, expect } from '@playwright/test';
import { ApiClient, ApiResult, apiBaseUrl } from '../../../api';
import { SEED, seedApiClient } from '../../../utils/seed-accounts';
import { ApiSweep, Actor, brief, fixtures } from '../../../utils/api-sweep';
import { record } from '../../../utils/ledger';
import { reportIssue } from '../../../utils/issues';

/**
 * API sweep: each significant API call of Phases 1-6 run once and classified against /cer/api-information
 * (SUCCESS / FAILURE / DOES NOT EXIST / PARAMETER MISMATCH / NOT RUN / NOT TESTABLE / SHARED - see
 * utils/api-sweep.ts). Results: report annotations + attachments and data/cache/<host>.api-results.md.
 *
 * Test data comes from the calls themselves, in phase order - Phase 2 registers a throwaway battery model
 * (API-<stamp>) with three units, which Phases 3, 4 and 6 correct, transfer, report on and recall. Nothing
 * seeded is changed: destructive calls (decommission, withdraw, close) only touch that throwaway data.
 * Data reused across runs (rule class, reconciliation run, last ids) is in data/cache/<host>.api-fixtures.json.
 *
 * Flags (run-e2e.ps1 -Scenario apisweep -Skip Exchange,Mail):
 *   API_SKIP=exchange,mail   report Phase 5 exchange calls / mail-sending calls as NOT RUN
 *   API_PHASES=1,2           run only these phases (data a skipped phase would create is then missing)
 *   PARTNER_API_KEY          enables the partner-facing inbox calls (otherwise NOT TESTABLE)
 *   API_RECON_PARTNER        partner for POST /exchange/reconciliation (default: network, the quickest
 *                            full run here at ~13 min; aemo ~15-50 min)
 */

test.describe.configure({ timeout: 1_200_000 });

const stamp = Date.now().toString(36).toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const phases = new Set((process.env.API_PHASES ?? '1,2,3,4,5,6').split(/[,\s]+/).map(Number));
const { sunvolt, gridcell } = SEED.participants;
const items = (r?: ApiResult<any>): any[] => (Array.isArray(r?.body) ? r!.body : r?.body?.items ?? r?.body?.versions ?? []);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
const ok = (r?: ApiResult<any>) => !!r && r.status >= 200 && r.status < 300;

/** Data created by earlier phases for later ones. */
const data: {
  modelId?: string; modelNumber?: string; batch?: string;
  unitA?: string; unitB?: string; unitC?: string; serialA?: string;
  instA?: string; instC?: string;
  incidentId?: string; recallId?: string;
} = {};

test('API sweep: significant calls of Phases 1-6 against /cer/api-information', async ({ request }) => {
  const sweep = new ApiSweep();
  await sweep.loadOpenApi(request);
  const actor = async (name: string): Promise<Actor> => ({ name, client: await seedApiClient(request, name) });
  const cer = await actor('cer.admin');
  const officer = await actor('cer.officer');
  const sv = await actor('sunvolt.admin');
  const gc = await actor('gridcell.admin');
  const byParticipant: Record<string, Actor> = { [sunvolt]: sv, [gridcell]: gc };
  test.info().annotations.push({ type: 'api docs', description: `/cer/api-information scraped ${sweep.scrapedAt}; base ${apiBaseUrl()}` });

  /** Set-up call that is not itself under test (soft: failure is reported and dependants become NOT TESTABLE). */
  const setup = async (a: Actor, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, phase = 0) => {
    const c = a.client;
    const r: ApiResult<any> = method === 'GET' ? await c.get(path) : method === 'PATCH' ? await c.patch(path, body ?? {}) : await c.post(path, body);
    if (!ok(r)) reportIssue(`API sweep set-up ${method} ${path} as ${a.name} -> ${r.status}: ${brief(r)}`);
    else if (method !== 'GET') sweep.setupNote(phase, `${a.name}: ${method} ${path} (${r.status})`);
    return r;
  };
  const need = (...values: (string | undefined)[]) => values.every(Boolean) ? undefined : 'test data from an earlier call is missing (see earlier failures)';

  // ============================================================ Phase 1
  if (phases.has(1)) await test.step('Phase 1: participant record as at a time', async () => {
    const before = await setup(cer, 'GET', `/participants/${sunvolt}/history`);
    const versions = items(before);
    const asOf = now();
    await sweep.call({
      phase: 1, method: 'GET', template: '/api/participants/:id', listed: ['query:asOf', 'query:knownAt'], as: cer,
      path: `/participants/${sunvolt}?asOf=${encodeURIComponent(asOf)}&knownAt=${encodeURIComponent(asOf)}`, expect: 200,
      check: r => r.body?.id === sunvolt ? undefined : `reply is not participant ${sunvolt}`,
    });
    // asOf before the participant existed must not return today's record.
    const early = await cer.client.get(`/participants/${sunvolt}?asOf=2000-01-01T00:00:00Z&knownAt=${encodeURIComponent(asOf)}`);
    test.info().annotations.push({ type: 'api check', description: `GET participant asOf=2000-01-01 -> ${early.status} (history has ${versions.length} versions)` });
    if (early.status === 200 && versions.length) reportIssue(`GET /participants/:id?asOf=2000-01-01 returned a record (${JSON.stringify(early.body).slice(0, 120)}) - asOf appears to be ignored`);
    await sweep.save(1);
  });

  // ============================================================ Phase 2
  if (phases.has(2)) await test.step('Phase 2: device register (rules, models, units, installations, rejections)', async () => {
    const P = 2;
    await sweep.call({ phase: P, method: 'GET', template: '/api/devices/rules', as: cer, path: '/devices/rules', expect: 200 });
    const classes = await sweep.call({ phase: P, method: 'GET', template: '/api/devices/rules/classes', as: cer, path: '/devices/rules/classes', expect: 200 });
    await sweep.call({
      phase: P, method: 'GET', template: '/api/devices/rules/classes/:class/current', listed: ['query:on'], as: sv,
      path: `/devices/rules/classes/battery/current?on=${today}`, expect: 200,
      check: r => r.body?.deviceClass === 'battery' || r.body?.class === 'battery' || JSON.stringify(r.body).includes('battery') ? undefined : 'reply is not the battery rule set',
    });

    // POST /rules: only ever on the sweep's own device class, so no real class gets a new rule version.
    // Each run adds one version, a day after the last, so versions never share a validFrom.
    const fx = fixtures.read();
    const ruleClass: string = fx.ruleClass ?? `e2e_api_${stamp.toLowerCase()}`;
    const knownClass = items(classes).some(c => c.deviceClass === ruleClass);
    const validFrom = knownClass && fx.ruleValidFrom ? [today, addDays(fx.ruleValidFrom, 1)].sort().pop()! : today;
    const open = { type: 'object', properties: {}, additionalProperties: true };
    const rulesPost = await sweep.call({
      phase: P, method: 'POST', template: '/api/devices/rules', as: cer, path: '/devices/rules', expect: 201,
      body: {
        deviceClass: ruleClass, displayName: `E2E API sweep class (${ruleClass})`, validFrom,
        fieldSchema: { model: open, unit: open, installation: open }, duplicateKeys: { model: [], unit: [], installation: [] },
        changeReason: 'E2E API sweep: rule version for the sweep\'s own device class',
      },
      note: `sweep-owned class ${ruleClass}${knownClass ? ` (new version from ${validFrom})` : ' (created)'}`,
    });
    if (ok(rulesPost)) fixtures.write({ ruleClass, ruleValidFrom: validFrom });

    // Model -> approved
    data.modelNumber = `API-${stamp}`;
    const model = await sweep.call({
      phase: P, method: 'POST', template: '/api/devices/models', as: sv, path: '/devices/models', expect: 201,
      body: { deviceClass: 'battery', modelNumber: data.modelNumber, name: `E2E API sweep battery ${stamp}`, attributes: { chemistry: 'LFP', capacity_kwh: 10, nominal_voltage_v: 51.2 } },
    });
    data.modelId = model?.body?.id;
    if (data.modelId) record({ event: 'model.requested', status: 'pending', deviceId: data.modelId, deviceClass: 'battery', modelNumber: data.modelNumber, participant: 'SunVolt' });
    await sweep.call({
      phase: P, method: 'GET', template: '/api/devices/models', as: sv, path: `/devices/models?q=${data.modelNumber}`, expect: 200,
      check: r => items(r).some(m => m.id === data.modelId) ? undefined : `q=${data.modelNumber} does not list the new model`,
    });
    const approved = await sweep.call({
      phase: P, method: 'PATCH', template: '/api/devices/models/:id/status', as: cer, path: `/devices/models/${data.modelId}/status`, expect: 200,
      body: { status: 'approved', changeReason: 'E2E API sweep: approve throwaway model' }, untestable: need(data.modelId),
    });
    if (ok(approved)) record({ event: 'model.approved', status: 'approved', deviceId: data.modelId, deviceClass: 'battery' });

    // Units: A (installed, recalled), B (transferred in Phase 3), C (installed then decommissioned here)
    data.batch = `API-${stamp}`;
    const unitBody = (s: string) => ({ modelId: data.modelId, serial: `API-${stamp}-${s}`, batch: data.batch, attributes: { usable_capacity_kwh: 9.6 } });
    const unitA = await sweep.call({ phase: P, method: 'POST', template: '/api/devices/units', as: sv, path: '/devices/units', expect: 201, body: unitBody('A'), untestable: need(data.modelId) });
    data.unitA = unitA?.body?.id; data.serialA = `API-${stamp}-A`;
    if (data.modelId) {
      data.unitB = (await setup(sv, 'POST', '/devices/units', unitBody('B'), P)).body?.id;
      data.unitC = (await setup(sv, 'POST', '/devices/units', unitBody('C'), P)).body?.id;
    }
    for (const [s, id] of [['A', data.unitA], ['B', data.unitB], ['C', data.unitC]]) {
      if (id) record({ event: 'unit.acquired', status: 'registered', deviceId: id, modelId: data.modelId, serialNumber: `API-${stamp}-${s}`, batch: data.batch, participant: 'SunVolt' });
    }
    // Rejections are RFC 9457 problem details with errors[] of {field, code, message}
    const bad = await sv.client.post('/devices/units', { modelId: data.modelId ?? SEED.models.svBat10, batch: data.batch });
    const errs = (bad.problem as any)?.errors as any[] | undefined;
    const rfc = [400, 422].includes(bad.status) && !!(bad.problem as any)?.title && Array.isArray(errs) && errs.every(e => 'field' in e && 'code' in e && 'message' in e);
    test.info().annotations.push({ type: 'api check', description: `invalid POST /devices/units (no serial) -> ${bad.status} ${JSON.stringify(bad.problem).slice(0, 200)}` });
    expect.soft(rfc, `rejection is RFC 9457 with errors[{field,code,message}]: ${JSON.stringify(bad.problem).slice(0, 200)}`).toBe(true);
    if (!rfc) reportIssue(`Rejected POST /devices/units is not RFC 9457 with errors[] of {field, code, message}: ${bad.status} ${JSON.stringify(bad.problem).slice(0, 200)}`);

    await sweep.call({
      phase: P, method: 'GET', template: '/api/devices/units', as: sv, path: `/devices/units?modelId=${data.modelId}`, expect: 200,
      check: r => items(r).length === 3 ? undefined : `modelId filter lists ${items(r).length} units, expected 3`, untestable: need(data.modelId),
    });

    // Installations by GridCell (installer) - A stays installed; C is decommissioned below
    const nmi = (n: number) => `6${(Date.now() + n).toString().slice(-9)}`;
    const instBody = (unitId?: string, n = 0) => ({
      unitId, nmi: nmi(n), commissionedOn: today,
      address: { line1: `${n + 1} Sweep St`, suburb: 'Torquay', state: 'VIC', postcode: '3228' },
      attributes: { mounting: 'wall', grid_connected: true },
    });
    const instA = await sweep.call({ phase: P, method: 'POST', template: '/api/devices/installations', as: gc, path: '/devices/installations', expect: 201, body: instBody(data.unitA, 0), untestable: need(data.unitA) });
    data.instA = instA?.body?.id;
    if (data.instA) record({ event: 'unit.installed', status: 'active', deviceId: data.unitA, installationId: data.instA, serialNumber: data.serialA, participant: 'GridCell' });
    if (data.unitC) data.instC = (await setup(gc, 'POST', '/devices/installations', instBody(data.unitC, 7), P)).body?.id;
    await sweep.call({
      phase: P, method: 'GET', template: '/api/devices/installations', as: gc, path: `/devices/installations?unitId=${data.unitA}`, expect: 200,
      check: r => items(r).some(i => i.id === data.instA) ? undefined : 'unitId filter does not list the new installation', untestable: need(data.instA),
    });
    await sweep.call({
      phase: P, method: 'POST', template: '/api/devices/installations/:id/decommission', as: gc, path: `/devices/installations/${data.instC}/decommission`, expect: 200,
      body: { decommissionedOn: today, changeReason: 'E2E API sweep: throwaway installation removed', evidenceRef: `E2E-${stamp}` }, untestable: need(data.instC),
    });
    await sweep.call({
      phase: P, method: 'PATCH', template: '/api/devices/units/:id/status', as: cer, path: `/devices/units/${data.unitC}/status`, expect: 200,
      body: { status: 'decommissioned', changeReason: 'E2E API sweep: throwaway unit decommissioned' }, untestable: need(data.unitC),
    });
    await sweep.call({
      phase: P, method: 'GET', template: '/api/devices/rejections', as: cer, path: '/devices/rejections?entityKind=unit&limit=20', expect: 200,
    });
    fixtures.write({ last: { ...data, at: now() } });
    await sweep.save(P);
  });

  // ============================================================ Phase 3
  if (phases.has(3)) await test.step('Phase 3: history, as-at views, corrections, transfer', async () => {
    const P = 3;
    const kinds = [
      { kind: 'models', id: data.modelId, changes: { name: `E2E API sweep battery ${stamp} (corrected)` } },
      { kind: 'units', id: data.unitA, changes: { batch: `${data.batch}-C` } },
      { kind: 'installations', id: data.instA, changes: { address: { line1: '1 Sweep St (corrected)', suburb: 'Torquay', state: 'VIC', postcode: '3228' } } },
    ] as const;
    for (const k of kinds) {
      const history = await sweep.call({
        phase: P, method: 'GET', template: `/api/devices/${k.kind}/:id/history`, as: cer, path: `/devices/${k.kind}/${k.id}/history`, expect: 200,
        check: r => items(r).length ? undefined : 'no versions returned', untestable: need(k.id),
      });
      const asOf = encodeURIComponent(now());
      await sweep.call({
        phase: P, method: 'GET', template: `/api/devices/${k.kind}/:id/at`, listed: ['query:asOf', 'query:knownAt'], as: cer,
        path: `/devices/${k.kind}/${k.id}/at?asOf=${asOf}&knownAt=${asOf}`, expect: 200, untestable: need(k.id),
        check: k.kind !== 'units' ? undefined : r => {
          const missing = ['installation', 'model', 'owner'].filter(f => !JSON.stringify(Object.keys(r.body ?? {})).toLowerCase().includes(f));
          return missing.length ? `unit as-at view has no ${missing.join(', ')} (keys: ${Object.keys(r.body ?? {}).join(', ')})` : undefined;
        },
      });
      const versions = items(history);
      const latest = versions.filter(v => !v.supersededBy && !v.validTo).sort((a, b) => b.versionId - a.versionId)[0] ?? versions[versions.length - 1] ?? {};
      const correctionOf = latest.versionId ?? latest.rowId ?? latest.id;
      await sweep.call({
        phase: P, method: 'POST', template: `/api/devices/${k.kind}/:id/corrections`, as: cer, path: `/devices/${k.kind}/${k.id}/corrections`,
        listed: ['body:correctionOf', 'body:changes', 'body:changeReason', 'body:evidenceRef?', 'body:validFrom?'], expect: [200, 201],
        body: { correctionOf, changes: k.changes, changeReason: `E2E API sweep: ${k.kind} correction`, evidenceRef: `E2E-${stamp}` },
        untestable: need(k.id, correctionOf === undefined ? undefined : 'x'),
      });
      if (k.kind === 'units' && k.id) record({ event: 'unit.corrected', status: 'registered', deviceId: k.id, serialNumber: data.serialA, participant: 'SunVolt' });
    }
    const transfer = await sweep.call({
      phase: P, method: 'POST', template: '/api/devices/units/:id/transfer', listed: ['body:newOwnerParticipantId', 'body:changeReason', 'body:evidenceRef?'], as: sv,
      path: `/devices/units/${data.unitB}/transfer`, expect: [200, 201],
      body: { newOwnerParticipantId: gridcell, changeReason: 'E2E API sweep: sold to GridCell', evidenceRef: `E2E-${stamp}` }, untestable: need(data.unitB),
    });
    if (ok(transfer)) record({ event: 'unit.transferred', status: 'registered', deviceId: data.unitB, participant: 'GridCell' });
    // Participants see history only for records in their own scope: Coastal-less check with GridCell on SunVolt's model.
    const outOfScope = await gc.client.get(`/devices/models/${SEED.models.svBat20}/history`);
    test.info().annotations.push({ type: 'api check', description: `gridcell.admin GET out-of-scope model history -> ${outOfScope.status}` });
    expect.soft([403, 404], 'out-of-scope history is refused').toContain(outOfScope.status);
    await sweep.save(P);
  });

  // ============================================================ Phase 4
  if (phases.has(4)) await test.step('Phase 4: participant users, password, incidents', async () => {
    const P = 4;
    await sweep.call({ phase: P, method: 'GET', template: '/api/participants/me/users', as: sv, path: '/participants/me/users', expect: 200 });
    const user = { username: `e2e.api.${stamp.toLowerCase()}`, password: `E2e-Api-${stamp}-a1!`, next: `E2e-Api-${stamp}-b2!` };
    const invited = await sweep.call({
      phase: P, method: 'POST', template: '/api/participants/me/users', as: sv, path: '/participants/me/users', expect: 201,
      body: { username: user.username, displayName: `E2E API sweep ${stamp}`, role: 'participant_user', password: user.password },
    });
    const userId = invited?.body?.id;
    if (userId) record({ event: 'user.invited', status: 'participant_user', username: user.username, participant: 'SunVolt' });
    await sweep.call({
      phase: P, method: 'PATCH', template: '/api/participants/me/users/:userId', listed: ['body:role?', 'body:disabled?'], as: sv,
      path: `/participants/me/users/${userId}`, expect: 200, body: { role: 'participant_admin' }, untestable: need(userId),
    });
    // Password change as the new user (never a seed account)
    let changed: ApiResult<any> | undefined;
    if (userId) {
      const own = new ApiClient(request);
      const login = await own.post<{ accessToken: string }>('/auth/login', { username: user.username, password: user.password });
      own.setToken(login.body?.accessToken);
      changed = await sweep.call({
        phase: P, method: 'POST', template: '/api/auth/password', listed: ['body:currentPassword', 'body:newPassword'], as: { name: user.username, client: own },
        path: '/auth/password', expect: [200, 204], body: { currentPassword: user.password, newPassword: user.next },
        untestable: login.status === 200 ? undefined : `new user cannot sign in: ${login.status} ${brief(login)}`,
      });
      if (ok(changed)) {
        const relog = await new ApiClient(request).post('/auth/login', { username: user.username, password: user.next });
        expect.soft(relog.status, 'signs in with the new password').toBe(200);
      }
      const off = await setup(sv, 'PATCH', `/participants/me/users/${userId}`, { disabled: true }, P);
      if (ok(off)) record({ event: 'user.updated', status: 'disabled', username: user.username, participant: 'SunVolt' });
    } else await sweep.call({ phase: P, method: 'POST', template: '/api/auth/password', as: sv, expect: 204, untestable: 'no sweep user to change the password of' });

    await sweep.call({ phase: P, method: 'GET', template: '/api/participants/:id/users', as: cer, path: `/participants/${sunvolt}/users`, expect: 200 });
    const mailUser = `e2e.api.mail.${stamp.toLowerCase()}`;
    const cerInvite = await sweep.call({
      phase: P, method: 'POST', template: '/api/participants/:id/users', as: cer, path: `/participants/${sunvolt}/users`, expect: 201, group: 'mail',
      body: { username: mailUser, displayName: `E2E API sweep mail ${stamp}`, role: 'participant_user', password: `E2e-Api-${stamp}-m3!`, email: `${mailUser}@example.com`, requireEmailVerification: true },
      note: 'sends a verification email',
    });
    const mailUserId = cerInvite?.body?.id;
    if (mailUserId) record({ event: 'user.invited', status: 'participant_user', username: mailUser, participant: 'SunVolt' });
    await sweep.call({
      phase: P, method: 'PATCH', template: '/api/participants/:id/users/:userId', listed: ['body:role?', 'body:disabled?'], as: cer,
      path: `/participants/${sunvolt}/users/${mailUserId ?? userId}`, expect: 200, body: { disabled: true },
      untestable: need(mailUserId ?? userId), note: mailUserId ? undefined : 'on the sweep user (mail invite not run)',
    });

    // Incidents on the sweep's unit A
    const raised = await sweep.call({
      phase: P, method: 'POST', template: '/api/incidents', as: sv, path: '/incidents', expect: 201,
      listed: ['body:unitId?', 'body:installationId?', 'body:modelId?', 'body:severity', 'body:title', 'body:description', 'body:occurredOn?', 'body:evidenceRef?'],
      body: { unitId: data.unitA, severity: 'high', title: `E2E API sweep ${stamp}: casing hot to touch`, description: 'Raised by the API sweep against its throwaway unit.', occurredOn: today, evidenceRef: `E2E-${stamp}` },
      untestable: need(data.unitA),
    });
    data.incidentId = raised?.body?.id;
    if (data.incidentId) record({ event: 'incident.raised', status: 'open', incidentId: data.incidentId, unitId: data.unitA, participant: 'SunVolt' });
    await sweep.call({
      phase: P, method: 'GET', template: '/api/incidents', listed: ['query:status', 'query:q'], as: cer, path: `/incidents?status=open&q=${encodeURIComponent(stamp)}`, expect: 200,
      check: r => !data.incidentId || items(r).some(i => i.id === data.incidentId) ? (items(r).every(i => i.status === 'open') ? undefined : 'status=open returned other statuses') : 'q does not find the new incident',
    });
    await sweep.call({ phase: P, method: 'GET', template: '/api/incidents/:id', as: sv, path: `/incidents/${data.incidentId}`, expect: 200, untestable: need(data.incidentId) });
    await sweep.call({
      phase: P, method: 'POST', template: '/api/incidents/:id/notes', as: sv, path: `/incidents/${data.incidentId}/notes`, expect: [200, 201],
      body: { note: 'E2E API sweep: unit isolated pending inspection.' }, untestable: need(data.incidentId),
    });
    const status = await sweep.call({
      phase: P, method: 'POST', template: '/api/incidents/:id/status', as: officer, path: `/incidents/${data.incidentId}/status`, expect: [200, 201],
      body: { status: 'acknowledged', note: 'E2E API sweep: acknowledged by CER' }, untestable: need(data.incidentId),
    });
    if (ok(status)) record({ event: 'incident.status', status: 'acknowledged', incidentId: data.incidentId });
    fixtures.write({ last: { ...data, at: now() } });
    await sweep.save(P);
  });

  // ============================================================ Phase 5 (group 'exchange')
  if (phases.has(5)) await test.step('Phase 5: information exchange', async () => {
    const P = 5;
    const ex = (template: string, path: string | undefined, extra: Partial<Parameters<ApiSweep['call']>[0]> = {}) =>
      sweep.call({ phase: P, method: 'GET', template, as: cer, path, expect: 200, group: 'exchange', ...extra });
    const lists: Record<string, ApiResult<any> | undefined> = {};
    for (const c of ['interfaces', 'summary', 'outbox', 'inbox', 'dead-letters', 'reconciliation']) lists[c] = await ex(`/api/exchange/${c}`, `/exchange/${c}${c === 'reconciliation' ? '?limit=40' : ''}`);
    // The phase list writes "{...}[/:id]" - read as applying to every collection.
    for (const c of ['interfaces', 'summary', 'outbox', 'inbox', 'dead-letters', 'reconciliation']) {
      const first = items(lists[c])[0];
      const id = first?.id ?? first?.key ?? first?.code;
      const nothing = sweep.skip.has('exchange') ? undefined : lists[c] && !first ? `no ${c} records to read` : undefined;
      await ex(`/api/exchange/${c}/:id`, `/exchange/${c}/${encodeURIComponent(id ?? 'x')}`, { untestable: nothing });
    }
    await sweep.call({
      phase: P, method: 'POST', template: '/api/exchange/outbox/publish-unpublished', as: cer, path: '/exchange/outbox/publish-unpublished',
      expect: [200, 202], group: 'exchange', note: 'Phase 5 run saw 504 on ~1.6M records',
    });
    // Dead letters cannot be created through the API (needs mock-partners fault injection) - use existing open ones.
    const open = items(await (sweep.skip.has('exchange') ? undefined : setup(cer, 'GET', '/exchange/dead-letters?status=open&limit=10')));
    for (const [i, action] of (['replay', 'discard'] as const).entries()) {
      await sweep.call({
        phase: P, method: 'POST', template: `/api/exchange/dead-letters/:id/${action}`, as: cer, path: open[i] ? `/exchange/dead-letters/${open[i].id}/${action}` : undefined,
        expect: [200, 202], group: 'exchange', body: { note: `E2E API sweep ${action}` },
        untestable: open[i] ? undefined : `no open dead letter to ${action}; none can be created through the API (needs mock-partners)`,
      });
    }
    // Reconciliation: one run at a time - a run takes ~50 min on this sandbox.
    const partner = process.env.API_RECON_PARTNER ?? 'network';
    const runs = items(lists.reconciliation);
    const running = runs.find(r => /running|pending|queued|started/i.test(r.status ?? ''));
    const started = await sweep.call({
      phase: P, method: 'POST', template: '/api/exchange/reconciliation', listed: ['body:partner'], as: cer, path: running ? undefined : '/exchange/reconciliation',
      expect: [200, 201, 202], group: 'exchange', body: { partner },
      untestable: running ? `run ${running.id} (${running.partner}) started ${running.startedAt ?? running.createdAt} is still ${running.status} - not starting another` : undefined,
    });
    if (started?.body?.id) fixtures.write({ reconciliationRun: { id: started.body.id, partner, at: now() } });
    // Page through the smallest completed run that has differences.
    const done = runs.filter(r => r.status === 'completed' && r.differences > 2).sort((a, b) => a.differences - b.differences)[0];
    const page1 = await sweep.call({
      phase: P, method: 'GET', template: '/api/exchange/reconciliation/:id/differences', listed: ['query:review', 'query:after', 'query:limit'], as: cer,
      path: done ? `/exchange/reconciliation/${done.id}/differences?review=all&limit=2` : undefined, expect: 200, group: 'exchange',
      untestable: done ? undefined : 'no completed reconciliation run',
      check: r => Array.isArray(r.body?.items) && 'next' in (r.body ?? {}) ? undefined : `reply has no items/next paging (${Object.keys(r.body ?? {}).join(', ')})`,
    });
    if (page1?.body?.next) {
      const page2 = await cer.client.get(`/exchange/reconciliation/${done.id}/differences?review=all&limit=2&after=${page1.body.next}`);
      const overlap = items(page2).some(d => items(page1).some(e => e.id === d.id));
      test.info().annotations.push({ type: 'api check', description: `differences page 2 (after=${page1.body.next}) -> ${page2.status}, ${items(page2).length} items${overlap ? ', OVERLAPS page 1' : ''}` });
      expect.soft(overlap, 'after= pages do not repeat items').toBe(false);
    }
    const unreviewed = done && !sweep.skip.has('exchange') ? items(await cer.client.get(`/exchange/reconciliation/${done.id}/differences?review=unreviewed&limit=1`))[0] : undefined;
    await sweep.call({
      phase: P, method: 'POST', template: '/api/exchange/reconciliation/differences/:id/review', listed: ['body:reviewStatus', 'body:note?'], as: cer,
      path: unreviewed ? `/exchange/reconciliation/differences/${unreviewed.id}/review` : undefined, expect: 200, group: 'exchange',
      body: { reviewStatus: 'accepted', note: 'E2E API sweep review' }, untestable: unreviewed ? undefined : 'no unreviewed difference in a completed run',
    });
    // Partner-facing (x-partner-key)
    const key = process.env.PARTNER_API_KEY;
    const partnerCall = async (template: string, path: string, body: unknown) => {
      if (key) return sweep.call({ phase: P, method: 'POST', template, as: { name: 'partner key', client: cer.client }, path, headers: { 'x-partner-key': key }, expect: [200, 201, 202], group: 'exchange', body });
      const r = sweep.skip.has('exchange') ? undefined : await new ApiClient(request).post(path, body);
      return sweep.call({ phase: P, method: 'POST', template, as: { name: 'no key', client: cer.client }, group: 'exchange', expect: 202,
        untestable: `no PARTNER_API_KEY; without a key the route answers ${r?.status ?? '?'}${r?.status === 404 ? ' (route missing?)' : ''}` });
    };
    await partnerCall('/api/exchange/inbox/:partner/:version/events', '/exchange/inbox/aemo/v2/events', { events: [] });
    await partnerCall('/api/exchange/inbox/stc/v1/files', '/exchange/inbox/stc/v1/files', {});
    await sweep.save(P);
  });

  // ============================================================ Phase 6
  if (phases.has(6)) await test.step('Phase 6: recalls', async () => {
    const P = 6;
    const raised = await sweep.call({
      phase: P, method: 'POST', template: '/api/recalls', as: officer, path: '/recalls', expect: 201,
      listed: ['body:modelId', 'body:batches?', 'body:incidentId?', 'body:severity', 'body:title', 'body:description', 'body:remedy', 'body:withdrawModel?'],
      body: {
        modelId: data.modelId, batches: [data.batch], incidentId: data.incidentId, severity: 'high', title: `E2E API sweep ${stamp}: recall`,
        description: 'Raised by the API sweep on its throwaway model.', remedy: 'Inspect and replace the module.', withdrawModel: true,
      },
      untestable: need(data.modelId),
    });
    data.recallId = raised?.body?.id;
    if (data.recallId) record({ event: 'recall.raised', status: 'open', recallId: data.recallId, modelId: data.modelId, batches: [data.batch], withdrawModel: true });
    await sweep.call({
      phase: P, method: 'GET', template: '/api/recalls', listed: ['query:status', 'query:modelId', 'query:unitId', 'query:q'], as: officer,
      path: `/recalls?status=open&modelId=${data.modelId}&unitId=${data.unitA}&q=${encodeURIComponent(stamp)}`, expect: 200,
      check: r => !data.recallId || items(r).some(x => x.id === data.recallId) ? undefined : 'filters do not find the new recall',
    });
    const recall = await sweep.call({
      phase: P, method: 'GET', template: '/api/recalls/:id', as: officer, path: `/recalls/${data.recallId}`, expect: 200, untestable: need(data.recallId),
      check: r => {
        const units = (r.body?.affectedUnits ?? []).map((u: any) => u.unitId);
        const expected = [data.unitA, data.unitB].filter(Boolean);
        return expected.every(u => units.includes(u)) && !units.includes(data.unitC) ? undefined : `affected units ${units.join(', ')} - expected A and B, not the decommissioned C`;
      },
    });
    const affected: any[] = recall?.body?.affectedUnits ?? [];
    await sweep.call({
      phase: P, method: 'POST', template: '/api/recalls/:id/notes', as: officer, path: `/recalls/${data.recallId}/notes`, expect: [200, 201],
      body: { note: 'E2E API sweep: recall note' }, untestable: need(data.recallId),
    });
    const a = affected.find(u => u.unitId === data.unitA) ?? affected[0];
    const responsible = a ? byParticipant[a.responsibleParticipantId] : undefined;
    const unitUntestable = !a ? need(undefined) : !responsible ? `responsible participant ${a.responsibleParticipantId} is not a seed account` : undefined;
    await sweep.call({
      phase: P, method: 'POST', template: '/api/recalls/:id/units/:unitId/notes', listed: ['body:status', 'body:note', 'body:evidenceRef?'], as: responsible ?? sv,
      path: a && `/recalls/${data.recallId}/units/${a.unitId}/notes`, expect: [200, 201], untestable: unitUntestable,
      body: { note: 'E2E API sweep: unit inspected', evidenceRef: `E2E-${stamp}` },
      note: 'phase list gives {status, note, evidenceRef?} for both unit calls; notes sent without status',
    });
    await sweep.call({
      phase: P, method: 'POST', template: '/api/recalls/:id/units/:unitId/status', listed: ['body:status', 'body:note', 'body:evidenceRef?'], as: responsible ?? sv,
      path: a && `/recalls/${data.recallId}/units/${a.unitId}/status`, expect: [200, 201], untestable: unitUntestable,
      body: { status: 'acknowledged', note: 'E2E API sweep: acknowledged', evidenceRef: `E2E-${stamp}` },
    });
    await sweep.call({ phase: P, method: 'POST', template: '/api/recalls/:id/refresh', as: officer, path: `/recalls/${data.recallId}/refresh`, expect: [200, 201], untestable: need(data.recallId) });
    // Close: every affected unit closed by CER first (set-up), then the recall.
    if (data.recallId) for (const u of (await officer.client.get<any>(`/recalls/${data.recallId}`)).body?.affectedUnits ?? []) {
      if (u.status !== 'closed') await setup(officer, 'POST', `/recalls/${data.recallId}/units/${u.unitId}/status`, { status: 'closed', note: 'E2E API sweep: closed by CER' }, P);
    }
    const closed = await sweep.call({
      phase: P, method: 'POST', template: '/api/recalls/:id/close', as: officer, path: `/recalls/${data.recallId}/close`, expect: [200, 201],
      body: { note: 'E2E API sweep: all units closed' }, untestable: need(data.recallId),
    });
    if (ok(closed)) record({ event: 'recall.closed', status: 'closed', recallId: data.recallId });
    fixtures.write({ last: { ...data, at: now() } });
    await sweep.save(P);
  });

  await sweep.save();
  const counts = sweep.results.filter(r => r.call !== '(set-up)').reduce<Record<string, number>>((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] ?? 0) + 1 }), {});
  test.info().annotations.push({ type: 'api summary', description: JSON.stringify(counts) });
  console.log('API sweep:', counts);
});
