const { open } = require('./lib');
const fs = require('fs'); const path = require('path');
(async () => {
  const key = process.argv[2];
  const { browser, page } = await open(key);
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/applications/mine', { headers: { authorization: 'Bearer ' + sessionStorage.getItem('regigov.accessToken') } });
    const j = res.status === 200 ? await res.json() : null;
    return res.status + ' ' + (j ? `${j.participant?.legalName} status=${j.status} decision=${j.decision} decidedAt=${j.decidedAt}` : '');
  });
  console.log(key, r);
  fs.rmSync(path.join(__dirname, 'out', key + '.token'), { force: true });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
