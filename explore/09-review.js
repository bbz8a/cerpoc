const { open, snap } = require('./lib');
(async () => {
  const { browser, page } = await open('admin');
  const nav = page.getByRole('navigation', { name: 'Workbench' });
  await nav.getByRole('link', { name: 'Participants' }).click();
  await page.getByRole('link', { name: 'Open the applications queue' }).click();
  await page.getByRole('link', { name: process.argv[2] }).first().click();
  await page.waitForTimeout(1500);
  await snap(page, 'review');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
