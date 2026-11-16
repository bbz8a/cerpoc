// Dumps the DOM ancestry of an affected unit's serial link on a recall. usage: node 42-p6-unit-dom.js <recallId> <serial>
const { login } = require('./19-phase2-cer');
(async () => {
  const [recallId, serial] = process.argv.slice(2);
  const { browser, page } = await login('cer.officer');
  await page.goto(`${process.env.BASE_URL}/cer/recalls/${recallId}`);
  await page.waitForTimeout(6000); console.log(page.url(), (await page.locator('body').ariaSnapshot()).slice(0, 1500));
  const link = page.getByRole('main').getByRole('link', { name: serial, exact: true });
  await link.waitFor();
  console.log(await link.evaluate(a => { const out = []; let e = a;
    for (let i = 0; i < 6 && e; i++, e = e.parentElement) out.push(`${e.tagName}.${e.className} children=${[...e.children].map(c => c.tagName + '.' + c.className).join(',')}`);
    return out.join('\n'); }));
  const btn = page.getByRole('main').getByRole('button', { name: 'Details' }).first();
  if (await btn.isVisible()) await btn.click();
  await page.waitForTimeout(1500);
  console.log(await link.evaluate(a => a.closest('li')?.outerHTML.slice(0, 2500) ?? 'no li'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
