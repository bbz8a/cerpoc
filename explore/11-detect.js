const { open, snap, ensureRole, readCurrentApplication } = require('./lib');
(async () => {
  const { browser, page } = await open('applicant');
  await ensureRole(page, 'applicant');
  console.log('CURRENT', await readCurrentApplication(page));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
