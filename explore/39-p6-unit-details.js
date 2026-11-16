// Phase 6 probe 2: open an affected unit's Details as gridcell.admin and cer.officer (actions visible), then close all.
process.env.OUTDIR = 'p6';
const { login, BASE } = require('./19-phase2-cer');
const { as } = require('./33-p4-api');
(async () => {
  const off = await as('cer.officer'), gc = await as('gridcell.admin');
  const r = await off('POST', '/recalls', { modelId: 'CER-M-0000000000000000000SVBAT10', batches: ['B2607-A'], severity: 'low', title: 'E2E probe P6: unit details layout', description: 'Exploration probe 2 for Phase 6; closed straight after.', remedy: 'No action - exploration probe only, closed by CER.' });
  const R = r.body.id; console.log('recall', R, r.status);
  for (const [user, path] of [['gridcell.admin', `/participant/recalls/${R}`], ['cer.officer', `/cer/recalls/${R}`]]) {
    const { browser, page } = await login(user);
    await page.goto(BASE + path, { waitUntil: 'commit' });
    await page.getByRole('heading', { name: 'Affected units' }).waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    await page.getByRole('main').getByRole('button', { name: 'Details' }).first().click(); await page.waitForTimeout(2000);
    const aria = await page.getByRole('main').ariaSnapshot();
    const from = aria.indexOf('heading "Affected units"'), to = aria.indexOf('region "Recall timeline"');
    console.log(`\n===== ${user}\n` + aria.slice(from, to));
    await page.screenshot({ path: `explore/out/p6/${user}-unit-details.png`, fullPage: true });
    await browser.close();
  }
  const units = (await off('GET', `/recalls/${R}`)).body.affectedUnits;
  for (const u of units) {
    for (const s of ['acknowledged', 'remediated']) await gc('POST', `/recalls/${R}/units/${u.unitId}/status`, { status: s, note: `Probe ${s}` });
    for (const s of ['verified', 'closed']) await off('POST', `/recalls/${R}/units/${u.unitId}/status`, { status: s, note: `Probe ${s}` });
  }
  const c = await off('POST', `/recalls/${R}/close`, { note: 'Probe 2 complete - all units closed' }); console.log('closed', c.status, c.body.status);
})().catch(e => { console.error(e); process.exit(1); });
