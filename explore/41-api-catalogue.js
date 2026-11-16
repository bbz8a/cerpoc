// Scrapes /cer/api-information as cer.admin: every call row plus its View page.
//   out/api/catalogue.json        raw rows + View text
//   data/api/api-information.json signatures from each View's "What you send" table (read by utils/api-sweep.ts)
// usage: node explore/41-api-catalogue.js
const { login } = require('./19-phase2-cer');
const fs = require('fs'); const path = require('path');
const WHERE = { 'Part of the address': 'path', 'After a question mark in the address': 'query', 'In the request body': 'body', 'In the header': 'header' };
(async () => {
  const { browser, page } = await login('cer.admin');
  await page.goto(process.env.BASE_URL + '/cer/api-information');
  await page.getByRole('status').filter({ hasText: /Showing \d+ of \d+ calls/ }).waitFor();
  const calls = await page.evaluate(() => [...document.querySelectorAll('main section, main [role=region]')].flatMap(sec => {
    const step = sec.querySelector('h2')?.textContent?.trim();
    return [...sec.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll('td').length === 5 && tr.querySelector('a')).map(tr => {
      const td = tr.querySelectorAll('td');
      return { step, name: td[0].querySelector('strong')?.textContent.trim(), summary: td[0].textContent.trim(), method: td[1].textContent.trim(),
        address: td[2].textContent.trim(), auth: td[3].textContent.trim(), view: td[4].querySelector('a')?.getAttribute('href') };
    });
  }));
  for (const c of calls) {
    await page.goto(process.env.BASE_URL + c.view);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    c.detail = (await page.getByRole('main').innerText()).replace(/\n{2,}/g, '\n');
  }
  fs.mkdirSync(path.join(__dirname, 'out', 'api'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'api', 'catalogue.json'), JSON.stringify(calls, null, 1));

  const sigs = {};
  for (const c of calls) {
    const lines = c.detail.split('\n');
    const i = lines.findIndex(l => /^Name\tWhere it goes\tRequired/.test(l));
    const params = [];
    if (i >= 0) for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].split('\t');
      if (t.length < 4) break;
      params.push({ name: t[0], in: WHERE[t[1]] ?? t[1], required: t[2] === 'Yes' });
    }
    sigs[`${c.method} ${c.address.replace(/\/$/, '')}`] = { name: c.name, step: c.step, auth: c.auth === 'Yes', view: c.view, who: (c.detail.match(/Who can use it\n(.*)/) || [])[1], params };
  }
  fs.mkdirSync(path.join(__dirname, '..', 'data', 'api'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'api', 'api-information.json'),
    JSON.stringify({ scrapedAt: new Date().toISOString(), source: '/cer/api-information', calls: sigs }, null, 1));
  for (const c of calls) console.log(c.step, '|', c.method, c.address, '| auth', c.auth, '|', c.name);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
