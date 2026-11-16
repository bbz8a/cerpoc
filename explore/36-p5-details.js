// Phase 5: outbox message detail and catalogue Behaviour group (read-only).
process.env.OUTDIR = 'p5';
const { login, BASE } = require('./19-phase2-cer');
const { snap } = require('./30-p4-nav');
(async () => {
  process.env.TAG = 'd';
  const { browser, page } = await login('cer.officer');
  await page.goto(BASE + '/cer/exchange/outbox/424', { waitUntil: 'commit' });
  await page.getByRole('heading', { level: 1 }).waitFor(); await page.waitForTimeout(3000);
  await snap(page, 'outbox-424');
  await page.goto(BASE + '/cer/exchange', { waitUntil: 'commit' });
  await page.getByRole('heading', { level: 1 }).waitFor(); await page.waitForTimeout(3000);
  const g = page.getByRole('main').getByRole('table').locator('tbody tr').first().locator('details');
  await g.locator('summary').click(); await page.waitForTimeout(500);
  console.log('BEHAVIOUR', await g.ariaSnapshot());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
