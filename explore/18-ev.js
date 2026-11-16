const { open } = require('./lib');
const fs = require('fs'); const path = require('path');
(async () => {
  const { browser, page } = await open('officer');
  // role already participant_admin for AUTO-MAN Legal 88823729105 from previous script
  await page.getByRole('main').getByRole('link', { name: 'My devices' }).click();
  await page.getByRole('link', { name: 'Register model' }).click();
  await page.getByRole('combobox', { name: /^Device class/ }).selectOption('ev_revolt_charger');
  await page.getByText(/Validating model attributes against/).waitFor();
  await page.waitForTimeout(800);
  const grp = page.locator('fieldset', { hasText: 'Class attributes' });
  console.log('EV fieldset text:\n' + await grp.innerText());
  console.log('EV textarea value:', JSON.stringify(await grp.locator('textarea').inputValue()));
  // Check what JSON editor shows for pv_module (structured) to learn format
  await page.getByRole('combobox', { name: /^Device class/ }).selectOption('pv_module');
  await page.getByText(/PV module/).first().waitFor(); await page.waitForTimeout(800);
  const btn = page.getByRole('button', { name: '(edit as JSON)' });
  if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(300);
    console.log('PV JSON editor value:', JSON.stringify(await page.locator('fieldset', { hasText: 'Class attributes' }).locator('textarea').inputValue())); }
  fs.rmSync(path.join(__dirname, 'out', 'officer.token'), { force: true });
  await browser.close();
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });
