const { open, ensureRole } = require('./lib');
const fs = require('fs'); const path = require('path');
(async () => {
  const { browser, page } = await open('officer');
  // participant_admin for an approved manufacturer
  console.log('at', page.url()); await page.screenshot({ path: path.join(__dirname, 'out', 'cf-start.png') });
  const menu = page.getByRole('banner').getByRole('button', { name: /▾$/ });
  await menu.click();
  const dlg = page.getByRole('dialog', { name: 'Switch role and organisation' });
  await dlg.getByRole('combobox', { name: 'Role' }).selectOption('participant_admin');
  await dlg.getByRole('searchbox', { name: 'Organisation' }).fill('AUTO-MAN Legal 88823729105');
  const list = dlg.getByRole('listbox', { name: 'Organisation' });
  await list.selectOption(await list.locator('option', { hasText: 'AUTO-MAN Legal 88823729105 (' }).getAttribute('value'));
  const ok = page.waitForResponse(r => r.url().includes('/api/testing/me/identity') && r.request().method() === 'POST');
  await dlg.getByRole('button', { name: 'Switch' }).click();
  console.log('switch status', (await ok).status());
  await dlg.waitFor({ state: 'hidden' });
  await page.waitForURL(/\/participant$/); await page.waitForLoadState('networkidle');
  console.log('switched', page.url());
  await page.getByRole('main').getByRole('link', { name: 'My devices' }).click();
  await page.getByRole('link', { name: 'Register model' }).click();
  const cls = page.getByRole('combobox', { name: /^Device class/ });
  const classes = await cls.evaluate(s => [...s.options].map(o => o.value).filter(Boolean));
  const out = {};
  for (const c of classes) {
    await cls.selectOption(c);
    await page.getByText(/Validating model attributes against/).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    out[c] = await page.evaluate(() => {
      const rules = document.body.innerText.match(/Validating model attributes against[^\n]*/)?.[0];
      const grp = [...document.querySelectorAll('fieldset')].find(f => /Class attributes/.test(f.innerText));
      const fields = grp ? [...grp.querySelectorAll('input,select,textarea')].map(el => ({
        name: el.labels?.[0]?.childNodes[0]?.textContent?.trim() || el.name || el.id,
        tag: el.tagName.toLowerCase(), type: el.type, required: el.required,
        min: el.min || undefined, max: el.max || undefined, step: el.step || undefined, pattern: el.pattern || undefined,
        options: el.tagName === 'SELECT' ? [...el.options].map(o => o.value).filter(Boolean) : undefined,
        hint: el.getAttribute('aria-describedby') ? document.getElementById(el.getAttribute('aria-describedby').split(' ')[0])?.textContent?.trim() : undefined,
      })) : [];
      return { rules, fields };
    });
  }
  fs.writeFileSync(path.join(__dirname, 'out', 'class-fields.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  fs.rmSync(path.join(__dirname, 'out', 'officer.token'), { force: true });
  await browser.close();
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); });
