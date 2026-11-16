// Phase 6 probe: raise a B2607-A recall on SV-BAT-10, snapshot each role's view with a unit expanded,
// check refusal codes, then drive every unit and the recall to closed (nothing left open).
process.env.OUTDIR = 'p6';
const { login, BASE } = require('./19-phase2-cer');
const { snap } = require('./30-p4-nav');
const { as } = require('./33-p4-api');
const SVBAT10 = 'CER-M-0000000000000000000SVBAT10';
(async () => {
  const off = await as('cer.officer'), gc = await as('gridcell.admin'), sv = await as('sunvolt.admin');
  const show = (l, r) => console.log(l, r.status, JSON.stringify(r.body).slice(0, 400));
  const raised = await off('POST', '/recalls', { modelId: SVBAT10, batches: ['B2607-A'], severity: 'critical', title: 'E2E probe P6: battery cell swelling', description: 'Exploration probe for the Phase 6 walkthrough; closed straight after.', remedy: 'Inspect and replace the battery module where swelling is found.' });
  show('raise', raised);
  const R = raised.body.id; const units = raised.body.affectedUnits || [];
  console.log('affected', units.map(u => `${u.serial} ${u.batch} ${u.status} resp=${u.responsibleParticipantName} inst=${u.installationId} nmi=${u.nmi}`));
  for (const [user, path] of [['cer.officer', `/cer/recalls/${R}`], ['gridcell.admin', `/participant/recalls/${R}`], ['sunvolt.admin', `/participant/recalls/${R}`]]) {
    process.env.TAG = user.replace('.', '_') + '-r';
    const { browser, page } = await login(user);
    await page.goto(BASE + path, { waitUntil: 'commit' });
    await page.getByRole('heading', { level: 2 }).first().waitFor({ timeout: 30000 }); await page.waitForTimeout(3000);
    const summary = page.getByRole('main').locator('summary', { hasText: 'SVB10-24-000101' });
    if (await summary.count()) { await summary.first().click(); await page.waitForTimeout(1500); }
    else { const b = page.getByRole('main').getByRole('button', { name: /SVB10-24-000101/ }); if (await b.count()) { await b.first().click(); await page.waitForTimeout(1500); } }
    await snap(page, 'recall-unit-expanded');
    await browser.close();
  }
  const U1 = units[0]?.unitId;
  show('sunvolt progress (expect 403)', await sv('POST', `/recalls/${R}/units/${U1}/status`, { status: 'acknowledged', note: 'manufacturer tries' }));
  show('close early (expect 409)', await off('POST', `/recalls/${R}/close`, { note: 'too early' }));
  show('gc verify early (expect 403/409)', await gc('POST', `/recalls/${R}/units/${U1}/status`, { status: 'verified', note: 'gc tries verify' }));
  show('refresh', await off('POST', `/recalls/${R}/refresh`));
  for (const u of units) {
    show('gc note', await gc('POST', `/recalls/${R}/units/${u.unitId}/notes`, { note: 'Probe note', evidenceRef: 'E2E-PROBE-EV' }));
    for (const s of ['acknowledged', 'remediated']) show(`gc ${s}`, await gc('POST', `/recalls/${R}/units/${u.unitId}/status`, { status: s, note: `Probe ${s}` }));
    for (const s of ['verified', 'closed']) show(`cer ${s}`, await off('POST', `/recalls/${R}/units/${u.unitId}/status`, { status: s, note: `Probe ${s}` }));
  }
  show('close recall', await off('POST', `/recalls/${R}/close`, { note: 'Probe complete - all units closed' }));
  const fin = await off('GET', `/recalls/${R}`); console.log('final', fin.body.status, JSON.stringify(fin.body.counts), 'unit events', JSON.stringify(fin.body.affectedUnits?.[0]?.events?.map(e => e.kind + ':' + (e.toStatus || ''))));
})().catch(e => { console.error(e); process.exit(1); });
