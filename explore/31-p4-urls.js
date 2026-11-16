// Phase 4: visit URLs as a seed user and snapshot main. usage: node 31-p4-urls.js <user> <path>...
const { login, BASE } = require('./19-phase2-cer');
const { snap } = require('./30-p4-nav');
(async () => {
  const user = process.argv[2];
  process.env.TAG = user.replace('.', '_') + '-u';
  const { browser, page } = await login(user);
  for (const p of process.argv.slice(3)) {
    await page.goto(BASE + '/' + p, { waitUntil: 'commit' });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await snap(page, p.replace(/\W+/g, '_'));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
