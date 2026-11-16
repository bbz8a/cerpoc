// Which requests return 403 on CER pages, per CER role? usage: node 37-p5-403.js
const { login, BASE } = require('./19-phase2-cer');
(async () => {
  for (const user of ['cer.officer', 'cer.admin']) {
    const { browser, page } = await login(user);
    const denied = new Set();
    page.on('response', r => { if (r.status() === 403) denied.add(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`); });
    for (const p of ['/cer', '/cer/exchange', '/cer/exchange?tab=outbox', '/cer/register']) {
      await page.goto(BASE + p, { waitUntil: 'commit' });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }
    console.log(user, denied.size ? [...denied] : 'no 403s');
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
