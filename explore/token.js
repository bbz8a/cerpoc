// Prints a fresh session token for an account key (admin|officer|applicant) - for MCP browser injection
const { open } = require('./lib');
const fs = require('fs'); const path = require('path');
(async () => {
  const key = process.argv[2];
  const f = path.join(__dirname, 'out', key + '.token'); if (fs.existsSync(f)) fs.unlinkSync(f);
  const { browser, page } = await open(key);
  process.stdout.write(await page.evaluate(() => sessionStorage.getItem('regigov.accessToken')));
  fs.unlinkSync(f);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
