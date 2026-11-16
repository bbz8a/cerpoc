const { login, snap } = require('./19-phase2-cer');
(async () => {
  const { browser, page } = await login('cer.admin');
  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('link', { name: 'Device register' }).click();
  await snap(page, 'register');
  const sections = page.getByRole('navigation', { name: 'Register sections' });
  await sections.getByRole('button', { name: /Rule sets/ }).click().catch(async () => { await page.getByRole('link', { name: /Rule sets/ }).click(); });
  await snap(page, 'rulesets');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
