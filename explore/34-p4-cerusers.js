// Phase 4: CER participant detail -> Users panel (officer vs admin); participant Overview links.
const { login, BASE } = require('./19-phase2-cer');
const { snap } = require('./30-p4-nav');
(async () => {
  for (const user of ['cer.officer', 'cer.admin']) {
    process.env.TAG = user.replace('.', '_') + '-p';
    const { browser, page } = await login(user);
    await page.goto(BASE + '/cer/participants/CER-P-01J0000000000000000SUNVOLT', { waitUntil: 'commit' });
    await page.getByRole('heading', { level: 1 }).waitFor(); await page.waitForTimeout(2000);
    await page.getByRole('main').locator('summary', { hasText: 'Users' }).click(); await page.waitForTimeout(3000);
    console.log(user, await page.getByRole('main').locator('details', { has: page.locator('summary', { hasText: 'Users' }) }).ariaSnapshot());
    await browser.close();
  }
  process.env.TAG = 'overview-';
  const { browser, page } = await login('sunvolt.admin');
  await page.waitForTimeout(3000);
  console.log('OVERVIEW LINKS', await page.getByRole('main').getByRole('link').evaluateAll(as => as.map(a => a.textContent.trim() + ' -> ' + a.getAttribute('href'))));
  console.log('BANNER', await page.getByRole('banner').innerHTML().then(h => h.slice(-1500)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
