const { open, snap } = require('./lib');
(async () => {
  const { browser, page } = await open('none');
  await page.goto(process.env.BASE_URL, { waitUntil: 'load' });
  await snap(page, 'landing');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
