const { chromium } = require('@playwright/test');
const path = require('path'); const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const OUT = path.join(__dirname, 'out', 'p2');
const BASE = process.env.BASE_URL.replace(/\/$/, '');
let n = 0;
async function snap(page, name) {
  n++; const tag = `${process.env.TAG || 'c'}${String(n).padStart(2, '0')}-${name}`;
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
  const aria = await page.locator('main').ariaSnapshot().catch(() => page.locator('body').ariaSnapshot());
  fs.writeFileSync(path.join(OUT, `${tag}.aria.yml`), aria);
  console.log(`\n===== ${tag} (${page.url()})\n${aria}`);
}
async function login(user) {
  const browser = await chromium.launch(); const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
  await page.goto(BASE + '/'); await page.getByLabel('Username').fill(user); await page.getByLabel('Password').fill(process.env.SANDBOX_SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000, waitUntil: 'commit' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return { browser, page };
}
module.exports = { login, snap, BASE };
if (require.main === module) (async () => {
  const { browser, page } = await login(process.argv[2] || 'cer.admin');
  console.log('BANNER', await page.getByRole('banner').innerText());
  console.log('NAV', await page.getByRole('navigation', { name: 'Workbench' }).ariaSnapshot());
  await snap(page, 'home');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
