// Phase 5: Exchange page (/cer/exchange) and each tab, read-only. usage: node 35-p5-exchange.js [user]
process.env.OUTDIR = 'p5';
const { login, BASE } = require('./19-phase2-cer');
const { snap } = require('./30-p4-nav');
(async () => {
  const user = process.argv[2] || 'cer.officer';
  process.env.TAG = user.replace('.', '_') + '-x';
  const { browser, page } = await login(user);
  await page.goto(BASE + '/cer/exchange', { waitUntil: 'commit' });
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30000 }); await page.waitForTimeout(3000);
  await snap(page, 'exchange');
  const tabs = await page.getByRole('main').getByRole('tab').allInnerTexts();
  console.log('TABS', tabs);
  for (const t of tabs) {
    await page.getByRole('main').getByRole('tab', { name: t.trim() }).click(); await page.waitForTimeout(3000);
    await snap(page, 'tab-' + t.trim().replace(/\W+/g, '_'));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
