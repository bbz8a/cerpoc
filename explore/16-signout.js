const { open, snap } = require('./lib');
(async () => {
  const { browser, page } = await open('officer');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForTimeout(1500);
  console.log('token after sign out:', await page.evaluate(() => sessionStorage.getItem('regigov.accessToken') ? 'present' : 'none'));
  await snap(page, 'after-signout');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
