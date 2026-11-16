import { Page, expect } from '@playwright/test';
import { pageApi } from './page-api';
import { record } from './ledger';
import { SEED } from './seed-accounts';

/**
 * Register setup through the API as the signed-in user - used where a walkthrough needs fresh data and the
 * UI path is covered elsewhere (Phase 2 covers the register UI). Each successful write goes to the ledger.
 */

/** Registers a battery unit (default model SV-BAT-10) as the signed-in participant; returns its CER-D- id. */
export async function registerUnit(page: Page, serial: string, batch: string, modelId: string = SEED.models.svBat10, participant = 'SunVolt'): Promise<string> {
  const res = await pageApi(page, 'POST', '/devices/units', { modelId, serial, batch, attributes: { usable_capacity_kwh: 9.6 } });
  expect(res.status, `POST /api/devices/units ${serial}: ${res.text.slice(0, 300)}`).toBe(201);
  record({ event: 'unit.acquired', status: 'registered', deviceId: res.json.id, modelId, serialNumber: serial, batch, participant });
  return res.json.id;
}

/** Registers a battery model as the signed-in manufacturer (pending); returns its CER-M- id. */
export async function registerBatteryModel(page: Page, modelNumber: string, name: string, participant = 'SunVolt'): Promise<string> {
  const res = await pageApi(page, 'POST', '/devices/models', {
    deviceClass: 'battery', modelNumber, name, attributes: { chemistry: 'LFP', capacity_kwh: 10, nominal_voltage_v: 51.2 },
  });
  expect(res.status, `POST /api/devices/models ${modelNumber}: ${res.text.slice(0, 300)}`).toBe(201);
  record({ event: 'model.requested', status: 'pending', deviceId: res.json.id, deviceClass: 'battery', modelNumber, participant });
  return res.json.id;
}

/** CER (devices:correct): approve or withdraw a model. */
export async function setModelStatus(page: Page, modelId: string, status: 'approved' | 'withdrawn', changeReason: string) {
  const res = await pageApi(page, 'PATCH', `/devices/models/${modelId}/status`, { status, changeReason });
  expect(res.status, `PATCH model status ${status}: ${res.text.slice(0, 300)}`).toBe(200);
  if (status === 'approved') record({ event: 'model.approved', status, deviceId: modelId, deviceClass: 'battery' });
}

/** Transfers a unit as the signed-in owner (or CER). */
export async function transferUnit(page: Page, unitId: string, newOwnerParticipantId: string, changeReason: string, participant?: string) {
  const res = await pageApi(page, 'POST', `/devices/units/${unitId}/transfer`, { newOwnerParticipantId, changeReason });
  expect(res.status, `POST transfer ${unitId}: ${res.text.slice(0, 300)}`).toBeLessThan(300);
  record({ event: 'unit.transferred', status: 'registered', deviceId: unitId, participant: participant ?? newOwnerParticipantId });
}

/** CER (devices:correct): decommission a unit, e.g. to take test data out of later recall scopes. */
export async function decommissionUnit(page: Page, unitId: string, changeReason: string) {
  const res = await pageApi(page, 'PATCH', `/devices/units/${unitId}/status`, { status: 'decommissioned', changeReason });
  expect(res.status, `PATCH unit status decommissioned: ${res.text.slice(0, 300)}`).toBe(200);
}
