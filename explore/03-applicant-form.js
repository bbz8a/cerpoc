const { open, snap } = require('./lib');
(async () => {
  const { browser, page } = await open('applicant');
  await page.getByRole('button', { name: /\(applicant\) ▾/ }).click();
  await snap(page, 'applicant-user-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start a new application' }).click();
  await snap(page, 'applicant-new-form');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
