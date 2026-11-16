const { open, snap, OUT, ensureRole, readCurrentApplication } = require('./lib');
const fs = require('fs'); const path = require('path');
function abn() { const w=[10,1,3,5,7,9,11,13,15,17,19];
  for(;;){const d=Array.from({length:11},()=>Math.floor(Math.random()*10));
    for(let f=1;f<=9;f++){d[0]=f;const a=[...d];a[0]-=1;if(a.reduce((s,x,i)=>s+x*w[i],0)%89===0)return d.join('');}}}
const action = process.argv[2] || 'Save draft';
(async () => {
  const { browser, page } = await open('applicant');
  page.on('response', async r => { if (r.url().includes('/api/applications') && r.request().method() !== 'GET')
    console.log('API', r.request().method(), r.url().replace(/^.*\/api/, '/api'), r.status(), r.status() >= 400 ? (await r.text()).slice(0,200) : ''); });
  await ensureRole(page, 'applicant');
  await snap(page, 'applicant-home');
  console.log('CURRENT', await readCurrentApplication(page));
  const start = page.getByRole('button', { name: 'Start a new application' });
  if (await start.isVisible()) await start.click();
  const A = abn(), p = 'AUTO-MAN';
  const org = { abn: A, legal_name: `${p} Legal ${A}` };
  fs.writeFileSync(path.join(OUT, 'org.json'), JSON.stringify(org));
  console.log('ORG', org);
  await page.getByRole('textbox', { name: 'Legal name' }).fill(org.legal_name);
  await page.getByRole('textbox', { name: 'Trading name (optional)' }).fill(`${p} Trading ${A}`);
  await page.getByRole('textbox', { name: 'ABN 11 digits' }).fill(A);
  await page.getByLabel('Participant type').selectOption('manufacturer');
  await page.getByRole('textbox', { name: 'Contact name' }).fill(`${p} Contact ${A}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(`AUTO.contact@${A}.com`);
  await page.getByRole('textbox', { name: 'Phone' }).fill('04' + String(Math.floor(Math.random()*1e8)).padStart(8,'0'));
  await page.getByRole('textbox', { name: 'Address line 1' }).fill('101 Main Street');
  await page.getByRole('textbox', { name: 'Suburb' }).fill('Melbourne');
  await page.getByLabel('State').selectOption('VIC');
  await page.getByRole('textbox', { name: 'Postcode' }).fill('3000');
  await page.getByRole('checkbox', { name: 'I am authorised to apply' }).check();
  await page.getByRole('checkbox', { name: 'The information provided is' }).check();
  await page.getByRole('textbox', { name: 'Evidence notes (optional)' }).fill(`Test evidence optional notes Automated for: ${org.legal_name}`);
  await page.getByRole('button', { name: action }).click();
  await page.waitForTimeout(2000);
  await snap(page, 'after-' + action.replace(/\s/g, '-'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
