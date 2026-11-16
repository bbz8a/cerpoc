const { open, snap } = require('./lib');
(async () => {
  const { browser, page } = await open('admin');
  const nav = page.getByRole('navigation', { name: 'Workbench' });
  await nav.getByRole('link', { name: 'Participants' }).click();
  const form = page.getByRole('search', { name: 'Search participants' });
  await form.getByRole('textbox', { name: 'Search' }).fill('AUTO-MAN');
  await form.getByRole('combobox', { name: 'Status' }).selectOption('pending');
  await form.getByRole('button', { name: 'Search' }).click();
  await page.getByText('Searching…').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => console.log('still searching'));
  await snap(page, 'participants-automan-pending');
  await page.getByRole('link', { name: 'Open the applications queue' }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'applications-queue');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
