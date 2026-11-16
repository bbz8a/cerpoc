// Summarises the local transaction cache: data/cache/<host>.ledger.json
//   node scripts/ledger-report.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const host = new URL(process.env.BASE_URL || 'http://unknown').host.replace(/[^a-z0-9.-]/gi, '_');
const file = path.resolve(__dirname, '..', 'data', 'cache', `${host}.ledger.json`);
if (!fs.existsSync(file)) { console.log(`No cache yet: ${file}`); process.exit(0); }

const { environment, events } = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`Cache: ${file}\nEnvironment: ${environment}\nEvents: ${events.length}\n`);

const counts = events.reduce((m, e) => ((m[e.event] = (m[e.event] || 0) + 1), m), {});
console.table(counts);

// Participants: approved, with their device classes
const created = new Map(events.filter(e => e.event === 'application.created').map(e => [e.abn, e]));
const approved = events.filter(e => e.event === 'application.approved');
const models = events.filter(e => e.event === 'model.approved');
const requested = events.filter(e => e.event === 'model.requested');

const rows = approved.map(a => {
  const c = created.get(a.abn) || {};
  const mine = models.filter(m => m.abn === a.abn);
  const pending = requested.filter(r => r.abn === a.abn && !models.some(m => m.deviceId === r.deviceId));
  return {
    abn: a.abn,
    legalName: a.legalName || c.legalName,
    type: a.type || c.type,
    approvedModels: mine.length,
    classes: [...new Set(mine.map(m => m.deviceClass))].join(', ') || '-',
    pendingModels: pending.length,
  };
});
console.log('\nApproved participants and their approved device classes:');
console.table(rows);

// Models requested but never approved (left pending by a failed run)
const orphans = requested.filter(r => !models.some(m => m.deviceId === r.deviceId) && !approved.some(a => a.abn === r.abn));
if (orphans.length) {
  console.log('\nModels requested for participants not in the approved list:');
  console.table(orphans.map(r => ({ abn: r.abn, deviceClass: r.deviceClass, modelNumber: r.modelNumber, deviceId: r.deviceId })));
}
