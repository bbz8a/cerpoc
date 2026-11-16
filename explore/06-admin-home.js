const { open, snap } = require('./lib');
(async () => {
  const { browser, page } = await open('admin');
  await snap(page, 'admin-home');
  await page.getByRole('button', { name: /▾$/ }).click();
  await snap(page, 'admin-user-menu');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
