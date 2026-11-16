const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  process.env.TAG = 'u';
  const { browser, page } = await login('sunvolt.admin');
  await page.goto(BASE + '/participant/devices/units/new');
  const model = page.getByRole('main').getByRole('combobox', { name: /^Model/ });
  await page.waitForTimeout(10000);
  console.log('MODELS', await model.locator('option').allTextContents());
  const opts = await model.locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
  if (opts.length) { await model.selectOption(opts[0]); await page.waitForTimeout(3000); await snap(page, 'unit-model-selected'); }
  await page.goto(BASE + '/participant/devices/units/CER-D-0000000000000000000SVINV6A'); await page.waitForTimeout(5000);
  await snap(page, 'unit-detail');
  await page.goto(BASE + '/participant/devices?tab=models'); await page.waitForTimeout(5000);
  await snap(page, 'models');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
