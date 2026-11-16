const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  process.env.TAG = 't';
  const { browser, page } = await login('sunvolt.admin');
  console.log('BANNER', await page.getByRole('banner').ariaSnapshot());
  await page.goto(BASE + '/participant/devices/units/CER-D-0000000000000000000SVINV6A'); 
  await page.getByRole('heading', { level: 1 }).waitFor(); await page.waitForTimeout(3000);
  await page.getByRole('main').locator('summary', { hasText: 'Transfer ownership' }).click(); await page.waitForTimeout(3000);
  console.log(await page.getByRole('main').getByRole('group').filter({ hasText: 'Transfer ownership' }).ariaSnapshot());
  console.log((await page.getByRole('main').locator('details', { hasText: 'Transfer ownership' }).locator('select option').allTextContents()).filter(t => /grid|sun|select/i.test(t)));
  await page.goto(BASE + '/participant/devices/models/new');
  const cls = page.getByRole('main').getByRole('combobox', { name: /^Device class/ });
  await cls.selectOption('battery'); await page.getByText(/Validating model attributes/).waitFor(); await page.waitForTimeout(1000);
  await snap(page, 'model-battery');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
