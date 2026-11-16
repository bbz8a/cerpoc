const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  process.env.TAG = 'n';
  const { browser, page } = await login(process.argv[2] || 'sunvolt.admin');
  page.on('response', async r => { if (r.url().includes('/api/')) console.log(r.request().method(), r.status(), r.url().replace(BASE, ''), r.request().method()==='GET' ? (await r.text().catch(()=>'')).slice(0, 300) : ''); });
  await page.goto(BASE + '/participant/devices'); await page.waitForTimeout(3000);
  console.log('---- click Register unit');
  await page.getByRole('main').getByRole('link', { name: 'Register unit' }).click();
  await page.waitForTimeout(8000);
  console.log('MODELS', await page.getByRole('main').getByRole('combobox', { name: /^Model/ }).locator('option').allTextContents());
  console.log('---- unit detail transfer');
  await page.goto(BASE + '/participant/devices/units/CER-D-0000000000000000000SVINV6A'); await page.waitForTimeout(4000);
  await page.getByRole('main').getByText('Transfer ownership').click(); await page.waitForTimeout(1500);
  console.log(await page.getByRole('main').getByRole('group').filter({ hasText: 'Transfer ownership' }).ariaSnapshot());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
