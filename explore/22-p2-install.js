const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  process.env.TAG = 'i';
  const { browser, page } = await login('cer.admin');
  await page.goto(BASE + '/cer/register/installations/new');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'Unit' }).waitFor();
  await page.waitForTimeout(3000);
  const unit = main.getByRole('combobox', { name: 'Unit' });
  const opt = await unit.locator('option', { hasText: 'GridCell' }).first().getAttribute('value');
  await unit.selectOption(opt);
  await page.waitForTimeout(3000);
  await snap(page, 'unit-selected');
  // details groups expand
  await page.goto(BASE + '/cer/register/rules'); await page.waitForTimeout(4000);
  const grp = page.getByRole('main').getByRole('table').first().getByRole('row').nth(1).getByText('schema & duplicate keys');
  await grp.click(); await page.waitForTimeout(500);
  console.log(await page.getByRole('main').getByRole('table').first().getByRole('row').nth(1).innerText());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
