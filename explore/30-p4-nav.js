// Phase 4 exploration: nav + home for each seed user, then the new screens.
const { login, BASE } = require('./19-phase2-cer');
const path = require('path'); const fs = require('fs');
const OUT = path.join(__dirname, 'out', process.env.OUTDIR || 'p4');
let n = 0;
async function snap(page, name) {
  n++; const tag = `${process.env.TAG || 'n'}${String(n).padStart(2, '0')}-${name}`;
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
  const aria = await page.locator('main').ariaSnapshot().catch(() => page.locator('body').ariaSnapshot());
  fs.writeFileSync(path.join(OUT, `${tag}.aria.yml`), aria);
  console.log(`\n===== ${tag} (${page.url()})\n${aria}`);
}
module.exports = { snap, OUT };
if (require.main === module) (async () => {
  const user = process.argv[2] || 'sunvolt.admin';
  process.env.TAG = user.replace('.', '_') + '-';
  const { browser, page } = await login(user);
  console.log('BANNER', await page.getByRole('banner').ariaSnapshot());
  console.log('NAV', await page.getByRole('navigation', { name: 'Workbench' }).ariaSnapshot());
  for (const link of process.argv.slice(3)) {
    await page.getByRole('navigation', { name: 'Workbench' }).getByRole('link', { name: link }).click();
    await page.getByRole('heading', { level: 1 }).waitFor(); await page.waitForTimeout(2500);
    await snap(page, link.replace(/\W+/g, '_'));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
