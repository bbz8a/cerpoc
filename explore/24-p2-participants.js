const { login, snap, BASE } = require('./19-phase2-cer');
(async () => {
  for (const user of process.argv.slice(2)) {
    process.env.TAG = user.replace('.', '_') + '-';
    const { browser, page } = await login(user);
    console.log('\n#### USER', user, '| banner:', (await page.getByRole('banner').getByRole('button', { name: /▾$/ }).innerText().catch(() => '?')).replace(/\s+/g, ' '), '| url', page.url());
    console.log((await page.getByRole('navigation', { name: 'Workbench' }).innerText().catch(() => '')).replace(/\s+/g, ' | '));
    await page.getByRole('navigation', { name: 'Workbench' }).getByRole('link', { name: 'My devices' }).click();
    await page.waitForTimeout(4000);
    await snap(page, 'mydevices');
    for (const [link, wait] of [['Register model', 'Validating'], ['Register unit', ''], ['Record installation', '']]) {
      const l = page.getByRole('main').getByRole('link', { name: link });
      if (await l.count() === 0) { console.log(`-- no link ${link}`); continue; }
      await l.first().click(); await page.waitForTimeout(8000); const sel = page.getByRole('main').getByRole('combobox').first(); console.log('FIRST COMBO OPTIONS', await sel.locator('option').allTextContents());
      await snap(page, link.replace(/ /g, '_'));
      await page.goBack(); await page.waitForTimeout(2000);
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
