// Phase 4 API probe: isolation checks, scope lookups, audit. usage: node 33-p4-api.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const API = new URL(process.env.BASE_URL).origin + '/api';
async function as(user) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: process.env.SANDBOX_SEED_PASSWORD }) });
  const { accessToken } = await r.json();
  return async (method, p, body) => {
    const res = await fetch(API + p, { method, headers: { authorization: 'Bearer ' + accessToken, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: res.status, body: j };
  };
}
module.exports = { as, API };
if (require.main === module) (async () => {
  const gc = await as('gridcell.admin');
  const show = (l, r) => console.log(l, r.status, JSON.stringify(r.body).slice(0, 600));
  show('me', await gc('GET', '/auth/me'));
  show('model SVBAT20', await gc('GET', '/devices/models/CER-M-0000000000000000000SVBAT20'));
  show('PATCH sunvolt', await gc('PATCH', '/participants/CER-P-01J0000000000000000SUNVOLT', { details: { tradingName: 'x' }, changeReason: 'probe' }));
  show('unit search 000101', await gc('GET', '/devices/units?q=SVB10-24-000101'));
  show('incidents', await gc('GET', '/incidents'));
  show('users me (gc)', await gc('GET', '/participants/me/users'));
  const sv = await as('sunvolt.user');
  show('users me (sv user)', await sv('GET', '/participants/me/users'));
  const cer = await as('cer.admin');
  show('audit denied', await cer('GET', '/audit/events?action=access.denied&limit=3'));
  show('cer units 000101', await cer('GET', '/devices/units?q=SVB10-24-000101'));
  show('cer users sunvolt', await cer('GET', '/participants/CER-P-01J0000000000000000SUNVOLT/users'));
  const off = await as('cer.officer');
  show('officer users sunvolt', await off('GET', '/participants/CER-P-01J0000000000000000SUNVOLT/users'));
  show('officer PATCH users', await off('PATCH', '/participants/CER-P-01J0000000000000000SUNVOLT/users/x', { disabled: false }));
})().catch(e => { console.error(e); process.exit(1); });
