const { login, BASE } = require('./19-phase2-cer');
(async () => {
  for (const [user, url] of [['sunvolt.admin', '/participant/devices/units/new'], ['cer.admin', '/cer/register/units/new']]) {
    const { browser, page } = await login(user);
    await page.goto(BASE + '/'); await page.waitForTimeout(2000);
    console.log('\n####', user, url);
    page.on('response', async r => { if (r.url().includes('/api/') && !/notifications|sim\/status|my-work/.test(r.url())) console.log(r.request().method(), r.status(), r.url().replace(BASE, ''), (await r.text().catch(()=>'')).slice(0, 160)); });
    page.on('console', m => { if (m.type() !== 'log') console.log('CONSOLE', m.type(), m.text().slice(0, 200)); });
    await page.goto(BASE + url); await page.waitForTimeout(8000);
    const model = page.getByRole('main').getByRole('combobox', { name: /^Model/ });
    const opts = await model.locator('option').allTextContents();
    console.log('MODEL OPTIONS', opts.length, opts.slice(0, 8));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
