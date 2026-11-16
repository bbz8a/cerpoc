// Phase 4: open the invite-user and report-incident forms; sunvolt.user on Users.
const { login, BASE } = require('./19-phase2-cer');
const { snap } = require('./30-p4-nav');
(async () => {
  process.env.TAG = 'f';
  let { browser, page } = await login('sunvolt.admin');
  await page.goto(BASE + '/participant/users', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Invite a user' }).click(); await page.waitForTimeout(1500);
  await snap(page, 'invite-form');
  console.log('BANNER LINKS', await page.getByRole('banner').getByRole('link').evaluateAll(as => as.map(a => a.textContent + ' ' + a.href)));
  console.log('SIDEBAR', await page.getByRole('complementary').ariaSnapshot().catch(() => ''));
  await browser.close();

  ({ browser, page } = await login('sunvolt.user'));
  await page.goto(BASE + '/participant/users', { waitUntil: 'commit' }); await page.waitForTimeout(4000);
  await snap(page, 'sunvolt_user-users');
  await browser.close();

  ({ browser, page } = await login('gridcell.admin'));
  await page.goto(BASE + '/participant/incidents/new', { waitUntil: 'commit' });
  await page.getByRole('heading', { level: 1 }).waitFor(); await page.waitForTimeout(3000);
  await snap(page, 'gridcell-report-form');
  const selects = page.getByRole('main').getByRole('combobox');
  for (let i = 0; i < await selects.count(); i++) {
    const s = selects.nth(i);
    console.log('SELECT', await s.getAttribute('aria-label'), await s.getAttribute('name'), JSON.stringify(await s.locator('option').evaluateAll(os => os.map(o => o.value + '=' + o.textContent)).then(x => x.slice(0, 40))));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
