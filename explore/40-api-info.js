// API information page probe: captures the page and the /api requests it makes. usage: node 40-api-info.js
const { login } = require('./19-phase2-cer');
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'out', 'api');
(async () => {
  const { browser, page } = await login('cer.admin');
  page.on('response', r => { if (r.url().includes('/api/')) console.log('NET', r.request().method(), r.status(), r.url()); });
  await page.goto(process.env.BASE_URL + '/cer/api-information');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  const aria = await page.locator('main').ariaSnapshot();
  fs.writeFileSync(path.join(OUT, 'api-info.aria.yml'), aria);
  fs.writeFileSync(path.join(OUT, 'api-info.html'), await page.locator('main').innerHTML());
  console.log(aria.slice(0, 6000));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
