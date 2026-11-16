import { test } from '@playwright/test';
import { getAccount, getAccountPair } from '../../utils/accounts';
import { signOut, startSession } from '../../utils/session';
import { ensureApprovedParticipant } from '../../flows/participant.flow';
import { approveModels, registerModels } from '../../flows/device.flow';
import { buildDeviceModel, buildModelOfSeedType, buildRetailerRange, DeviceModel } from '../../dynamic.data/device-model.builder';
import { unmappableCellTechnologies } from '../../dynamic.data/pv-model.builder';
import { ParticipantType } from '../../types/organisation';

/**
 * BAU positive flow - device model registration and approval for use.
 * Every participant type may register any device class. Coverage:
 *   - each participant type registers one model, rotating so every class is covered
 *   - a retailer registers one model per device type it sells (profile from
 *     data/other.device.retailer.json) - multi-device participant
 * Flow: participant_admin (acting for an approved participant) registers -> pending;
 *       CER admin approves for use -> approved.
 *
 * Participant: latest approved of that type from the local cache, else the first approved
 * AUTO-<TYPE> in the participant register, else created and approved first.
 * A refusal by the app (e.g. "a installer cannot register device models") is reported
 * as an 'issue' and fails the test with the app's message.
 *
 *   participant account -> E2E_PARTICIPANT (default: officer = outlook account)
 *   applicant account   -> E2E_APPLICANT   (default: officer; only if a participant must be created)
 *   approver account    -> E2E_APPROVER    (default: admin   = indigitise account)
 */

const CASES: { type: ParticipantType; title: string; models: () => { models: DeviceModel[]; note?: string } }[] = [
  { type: 'manufacturer', title: 'Manufacturer registers a PV module', models: () => ({ models: [buildDeviceModel('pv_module')] }) },
  { type: 'importer', title: 'Importer registers an inverter', models: () => ({ models: [buildDeviceModel('inverter')] }) },
  { type: 'installer', title: 'Installer registers a PV battery', models: () => ({ models: [buildModelOfSeedType('PV_battery')] }) },
  { type: 'aggregator', title: 'Aggregator registers an EV charger', models: () => ({ models: [buildDeviceModel('ev_revolt_charger')] }) },
  {
    type: 'retailer', title: 'Retailer registers each device type it sells',
    models: () => {
      const { profile, models } = buildRetailerRange();
      return { models, note: `${profile.retailerName} (${profile.supplierType}) sells ${profile.deviceTypesSold.join(', ')}` };
    },
  },
];

const [participantAccount, approver] = getAccountPair(process.env.E2E_PARTICIPANT ?? 'officer', process.env.E2E_APPROVER ?? 'admin');
const applicant = getAccount(process.env.E2E_APPLICANT ?? 'officer');

// serial: accounts share server-side role state; 5 min: retailer case registers several models
test.describe.configure({ mode: 'serial', timeout: 300_000 });

for (const c of CASES) {
  test(`Device model: ${c.title}, CER approves for use`, async ({ page }) => {
    const notes = test.info().annotations;
    notes.push({ type: 'accounts', description: `participant=${participantAccount.key}, approver=${approver.key}` });
    const { models, note } = c.models();
    if (note) notes.push({ type: 'retailer profile', description: note });
    for (const m of models) {
      notes.push({ type: 'device', description: `${m.seedType} -> ${m.deviceClass}: ${m.modelNumber} "${m.modelName}" ${JSON.stringify(m.attributes)}` });
    }
    if (models.some(m => m.deviceClass === 'pv_module')) {
      notes.push({ type: 'data gap', description: `PV cell technologies with no form option (excluded): ${unmappableCellTechnologies().join(', ')}` });
    }

    await startSession(page);
    const participant = await ensureApprovedParticipant(page, c.type, applicant, approver);
    const registered = await registerModels(page, participantAccount, participant, models);
    await approveModels(page, approver, participant, registered);
    await signOut(page);
  });
}
