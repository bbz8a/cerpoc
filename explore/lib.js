const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const OUT = path.join(__dirname, 'out');
const BASE = process.env.BASE_URL.replace(/\/$/, '');
const USERS = {
  applicant: ['APPLICANT_PARTICIPANT_USERNAME', 'APPLICANT_PARTICIPANT_PASSWORD'],
  admin: ['CER_ADMIN_USERNAME', 'CER_ADMIN_PASSWORD'],
  officer: ['CER_OFFICER_USERNAME', 'CER_OFFICER_PASSWORD'],
};

let n = 0;
async function snap(page, name, { quiet = false } = {}) {
  n++;
  const tag = `${process.env.TAG || ''}${String(n).padStart(2, '0')}-${name}`;
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
  let aria = await page.locator('body').ariaSnapshot();
  fs.writeFileSync(path.join(OUT, `${tag}.aria.yml`), aria);
  // trim static chrome for console readability
  aria = aria.split('\n').filter(l => !/Skip to content|#main-content|Testing mode|Synthetic data|Australian Government Clean/.test(l)).join('\n');
  if (!quiet) console.log(`\n===== ${tag}  (${page.url()})\n${aria}`);
}

/** Logs in (or reuses a saved sessionStorage token) and returns a page on the user's home. */
async function open(userKey, { headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } });
  const tokenFile = path.join(OUT, `${userKey}.token`);
  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile, 'utf8');
    await context.addInitScript(t => { if (!sessionStorage.getItem('regigov.accessToken')) sessionStorage.setItem('regigov.accessToken', t); }, token);
  }
  const page = await context.newPage();
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('URL ->', f.url()); });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (page.url().includes('/login')) {
    const [u, p] = USERS[userKey];
    await page.getByLabel('Username').fill(process.env[u]);
    await page.getByLabel('Password').fill(process.env[p]);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    fs.writeFileSync(tokenFile, await page.evaluate(() => sessionStorage.getItem('regigov.accessToken')));
  }
  return { browser, context, page };
}

module.exports = { open, snap, OUT, BASE };

/** Ensure the signed-in account is in the given role (server remembers last role). */
async function ensureRole(page, role) {
  const menu = page.getByRole('button', { name: /▾$/ });
  const label = (await menu.innerText()).replace(/\s+/g, ' ');
  console.log('Role label:', label);
  if (label.includes(`(${role})`)) return;
  await menu.click();
  await page.getByRole('combobox', { name: 'Role' }).selectOption(role);
  await page.getByRole('button', { name: 'Switch' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(r => [...document.querySelectorAll('button')].some(b => b.innerText.includes('(' + r + ')')), role);
}

/** Reads the applicant's current application summary, if any. */
async function readCurrentApplication(page) {
  const main = page.getByRole('main');
  const hasStart = await main.getByRole('button', { name: 'Start a new application' }).isVisible();
  const heading = main.getByRole('heading', { level: 2 }).first();
  const name = (await heading.count()) ? (await heading.innerText()).trim() : null;
  const text = await main.innerText();
  const status = (text.match(/\n(draft|submitted|under assessment|returned|approved|rejected|withdrawn)\n/) || [])[1] || null;
  return { name, status, hasStart, awaiting: /awaiting assessment/i.test(text) };
}
module.exports.ensureRole = ensureRole;
module.exports.readCurrentApplication = readCurrentApplication;
