const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  process.env.TAG = 'r';
  const { browser, page } = await login('cer.admin');
  await page.goto(BASE + '/cer/register/rules');
  await page.waitForTimeout(6000);
  await snap(page, 'rulesets');
  await page.getByRole('button', { name: 'New device class' }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'newclass');
  await page.goto(BASE + '/cer/register/installations/new');
  await page.waitForTimeout(5000);
  await snap(page, 'install-new');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
