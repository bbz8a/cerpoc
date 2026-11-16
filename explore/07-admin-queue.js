const { open, snap } = require('./lib');
const strip = s => s;
(async () => {
  const { browser, page } = await open('admin');
  const menu = page.getByRole('button', { name: /▾$/ });
  if (!/\(cer_admin\)/.test(await menu.innerText())) {
    await menu.click();
    const role = page.getByRole('combobox', { name: 'Role' });
    console.log('role values', await role.evaluate(s => [...s.options].map(o => o.value + '=' + o.text)));
    await role.selectOption({ label: 'CER admin' });
    await snap(page, 'admin-switch-dialog-cer', { quiet: false });
    await page.getByRole('button', { name: 'Switch' }).click();
  }
  await snap(page, 'cer-home');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
