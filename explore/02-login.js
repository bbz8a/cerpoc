const { open, snap, creds } = require('./lib');
const who = process.argv[2];
(async () => {
  const { browser, context, page, state } = await open(who + '-fresh');
  const c = creds(who);
  await page.goto(process.env.BASE_URL, { waitUntil: 'load' });
  await page.getByLabel('Username').fill(c.username);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {});
  await snap(page, `${who}-after-login`);
  await context.storageState({ path: state.replace('-fresh', '') });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
