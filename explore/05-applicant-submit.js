const { open, snap, OUT } = require('./lib');
const fs = require('fs'); const path = require('path');

function abn() { // same algorithm as dynamic.data/generate.ts
  const w = [10,1,3,5,7,9,11,13,15,17,19];
  for (;;) { const d = Array.from({length:11}, () => Math.floor(Math.random()*10));
    for (let f = 1; f <= 9; f++) { d[0] = f; const a = [...d]; a[0] -= 1;
      if (a.reduce((s,x,i) => s + x*w[i], 0) % 89 === 0) return d.join(''); } }
}
(async () => {
  const { browser, page } = await open('applicant');
  const opts = await page.evaluate(() => [...document.querySelectorAll('select')].map(s => ({ label: s.labels?.[0]?.textContent, values: [...s.options].map(o => o.value + '=' + o.text) })));
  const A = abn(), p = 'AUTO-MAN';
  const org = { abn: A, legal_name: `${p} Legal ${A}`, type: 'manufacturer', state: 'VIC', postcode: '3000', suburb: 'Melbourne' };
  fs.writeFileSync(path.join(OUT, 'org.json'), JSON.stringify(org, null, 2));
  console.log('ORG', org);

  await page.getByRole('button', { name: 'Start a new application' }).click();
  console.log('selects', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('select')].map(s => ({ id: s.id, label: s.labels?.[0]?.textContent, values: [...s.options].map(o => o.value) })))));
  await page.getByRole('textbox', { name: 'Legal name' }).fill(org.legal_name);
  await page.getByRole('textbox', { name: 'Trading name (optional)' }).fill(`${p} Trading ${A}`);
  await page.getByRole('textbox', { name: 'ABN 11 digits' }).fill(A);
  await page.getByLabel('Participant type').selectOption('manufacturer');
  await page.getByRole('textbox', { name: 'Contact name' }).fill(`${p} Contact ${A}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(`AUTO.contact@${A}.com`);
  await page.getByRole('textbox', { name: 'Phone' }).fill('04' + String(Math.floor(Math.random()*1e8)).padStart(8,'0'));
  await page.getByRole('textbox', { name: 'Address line 1' }).fill('101 Main Street');
  await page.getByRole('textbox', { name: 'Suburb' }).fill(org.suburb);
  await page.getByLabel('State').selectOption(org.state);
  await page.getByRole('textbox', { name: 'Postcode' }).fill(org.postcode);
  await page.getByRole('checkbox', { name: 'I am authorised to apply' }).check();
  await page.getByRole('checkbox', { name: 'The information provided is' }).check();
  await page.getByRole('textbox', { name: 'Evidence notes (optional)' }).fill(`Test evidence optional notes Automated for: ${org.legal_name}`);
  await snap(page, 'applicant-form-filled', { quiet: true });
  await page.getByRole('button', { name: 'Submit to CER' }).click();
  await page.waitForTimeout(2000);
  await snap(page, 'applicant-after-submit');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
