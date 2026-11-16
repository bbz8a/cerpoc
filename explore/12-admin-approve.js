const { open, snap, ensureRole } = require('./lib');
const target = process.argv[2];
(async () => {
  const { browser, page } = await open('admin');
  page.on('response', async r => { if (r.url().includes('/api/') && !['GET','OPTIONS'].includes(r.request().method()))
    console.log('API', r.request().method(), r.url().replace(/^.*\/api/, '/api'), r.status()); });
  await ensureRole(page, 'cer_admin');
  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('link', { name: 'Participants' }).click();
  await page.getByRole('link', { name: 'Open the applications queue' }).click();
  await page.getByRole('link', { name: target, exact: true }).click();
  await page.getByRole('heading', { level: 1, name: target }).waitFor();

  const field = l => page.locator(`dt:text-is("${l}") + dd`).innerText();
  const ids = { legal: await field('Legal name'), address: await field('Address'), app: await field('Application ID'), pid: await field('Participant ID') };
  console.log('IDS', ids);

  await page.getByRole('textbox', { name: 'Add assessment note' }).fill(`Name: ${ids.legal}\nAddress: ${ids.address}\nApplication ID: ${ids.app}\nParticipant ID: ${ids.pid}`);
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'after-add-note', { quiet: true });

  await page.getByRole('radio', { name: 'Approve' }).check();
  await page.getByRole('textbox', { name: /^Reason/ }).fill('This an automated approval by Playwright');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await page.waitForTimeout(2000);
  await snap(page, 'after-decision');

  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('link', { name: 'Participants' }).click();
  const form = page.getByRole('search', { name: 'Search participants' });
  await form.getByRole('textbox', { name: 'Search' }).fill(ids.legal);
  await form.getByRole('button', { name: 'Search' }).click();
  await page.getByText('Searching…').waitFor({ state: 'hidden' }).catch(() => {});
  await page.waitForTimeout(1000);
  console.log('REGISTER ROWS:', await page.locator('tbody tr').allInnerTexts());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
