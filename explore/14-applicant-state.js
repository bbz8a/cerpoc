const { open, snap, ensureRole } = require('./lib');
(async () => {
  const { browser, page } = await open('applicant');
  await ensureRole(page, 'applicant');
  const mine = await page.evaluate(async () => {
    const r = await fetch('/api/applications/mine', { headers: { authorization: 'Bearer ' + sessionStorage.getItem('regigov.accessToken') } });
    return r.status + ' ' + (await r.text()).slice(0, 1500);
  });
  console.log('MINE', mine);
  await snap(page, 'applicant-home-after-draft');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
