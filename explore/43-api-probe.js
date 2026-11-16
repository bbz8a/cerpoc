// API sweep probe: validation messages for bodies not documented on /cer/api-information (sends invalid bodies only).
const { as } = require('./33-p4-api');
(async () => {
  const cer = await as('cer.admin');
  const show = (l, r) => console.log('\n#', l, r.status, JSON.stringify(r.body).slice(0, 900));
  show('route 404', await cer('GET', '/exchange/summary/x'));
  show('rules list', await cer('GET', '/devices/rules'));
  show('rules classes', await cer('GET', '/devices/rules/classes'));
  show('POST rules {}', await cer('POST', '/devices/rules', {}));
  const h = await cer('GET', '/devices/units/CER-D-000000000000000000SVBAT10A/history');
  show('unit history', h);
  show('unit corrections {}', await cer('POST', '/devices/units/CER-D-000000000000000000SVBAT10A/corrections', {}));
  const inc = await cer('GET', '/incidents');
  show('incidents', inc);
  const id = (inc.body.items ?? inc.body)[0]?.id;
  show('incident notes {}', await cer('POST', `/incidents/${id}/notes`, {}));
  show('incident status {}', await cer('POST', `/incidents/${id}/status`, {}));
  show('recall notes {}', await cer('POST', '/recalls/CER-R-01M7HT4FMVPCAD769FQQHDQYPZ/notes', {}));
  show('recall close {}', await cer('POST', '/recalls/CER-R-01M7HT4FMVPCAD769FQQHDQYPZ/close', {}));
  show('recon list', await cer('GET', '/exchange/reconciliation?limit=5'));
  show('dead letters open', await cer('GET', '/exchange/dead-letters?status=open&limit=3'));
  show('participant asOf', await cer('GET', `/participants/CER-P-01J0000000000000000SUNVOLT?asOf=${new Date().toISOString()}&knownAt=${new Date().toISOString()}`));
  show('partner no key', await fetch(process.env.BASE_URL + '/api/exchange/inbox/aemo/v2/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(async r => ({ status: r.status, body: await r.text() })));
})().catch(e => { console.error(e); process.exit(1); });
