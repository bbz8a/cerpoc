const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  process.env.TAG = 'm';
  const { browser, page } = await login('sunvolt.admin');
  page.on('response', async r => { if (r.url().includes('/api/devices')) console.log(r.request().method(), r.status(), r.url().replace(BASE, ''), (await r.text().catch(()=>'')).slice(0, 200)); });
  await page.goto(BASE + '/participant/devices?tab=models'); await page.waitForTimeout(4000);
  await page.getByRole('main').getByRole('link', { name: 'SV-BAT-10', exact: true }).click();
  await page.waitForTimeout(5000);
  await snap(page, 'model-detail');
  const l = page.getByRole('main').getByRole('link', { name: /Register unit/ });
  if (await l.count()) { await l.first().click(); await page.waitForTimeout(6000); await snap(page, 'unit-from-model'); }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
