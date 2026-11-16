const { open, snap, ensureRole } = require('./lib');
(async () => {
  const { browser, page } = await open('applicant');
  page.on('response', async r => { if (r.url().includes('/api/applications') && r.request().method() !== 'GET')
    console.log('API', r.request().method(), r.url().replace(/^.*\/api/, '/api'), r.status(), r.status() >= 400 ? (await r.text()).slice(0,200) : ''); });
  await ensureRole(page, 'applicant');
  await page.getByRole('button', { name: 'Submit to CER' }).click();
  await page.getByText('Your application is in the CER queue awaiting assessment').waitFor({ timeout: 20000 }).catch(() => console.log('no awaiting text'));
  await snap(page, 'after-submit-draft');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
