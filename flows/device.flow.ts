import { Page, test } from '@playwright/test';
import { CerUser, ParticipantUser } from '../pages';
import { Account } from '../utils/accounts';
import { signInAs } from '../utils/session';
import { record, CachedParticipant } from '../utils/ledger';
import { DeviceModel } from '../dynamic.data/device-model.builder';

export interface RegisteredModel { model: DeviceModel; modelId: string }

/**
 * Participant admin (acting for an approved participant of any type) registers
 * one or more device models. Each starts as pending (awaiting CER approval).
 */
export async function registerModels(
  page: Page, participantAccount: Account, participant: CachedParticipant, models: DeviceModel[],
): Promise<RegisteredModel[]> {
  const p = new ParticipantUser(page);
  const registered: RegisteredModel[] = [];
  await test.step(`Participant admin for ${participant.legalName} registers ${models.length} model(s)`, async () => {
    await signInAs(page, participantAccount);
    await p.base.ensureRole('participant_admin', participant.legalName);
    await p.workbench.expectActingFor(participant.legalName, 'approved');
    for (const model of models) {
      await p.base.nav.getByRole('link', { name: 'My devices' }).click();
      await p.myDevices.openRegisterModel();
      const modelId = await p.registerModel.registerModel(model);
      registered.push({ model, modelId });
      record({
        event: 'model.requested', deviceId: modelId, abn: participant.abn, legalName: participant.legalName,
        participantType: participant.type, deviceClass: model.deviceClass, modelNumber: model.modelNumber,
        modelName: model.modelName, metadata: model.attributes, status: 'pending',
      });
    }
  });
  return registered;
}

/** CER admin approves each model for use (Change model status -> Approve, with reason). */
export async function approveModels(
  page: Page, approver: Account, participant: CachedParticipant, models: RegisteredModel[],
) {
  const cer = new CerUser(page);
  await test.step(`CER admin approves ${models.length} model(s) for use`, async () => {
    await signInAs(page, approver);
    await cer.base.ensureRole('cer_admin');
    for (const { model, modelId } of models) {
      await cer.deviceRegister.openModels();
      await cer.deviceRegister.searchModels(model.modelNumber, 'pending');
      await cer.deviceRegister.openModel(model.modelNumber);
      await cer.modelReview.expectDetails({ modelId, manufacturer: participant.legalName, status: 'pending' });
      await cer.modelReview.changeStatus('Approve', 'Approved for use - automated by Playwright');
      await cer.deviceRegister.openModels();
      await cer.deviceRegister.expectModelStatus(model.modelNumber, 'approved');
      record({
        event: 'model.approved', deviceId: modelId, abn: participant.abn, legalName: participant.legalName,
        deviceClass: model.deviceClass, modelNumber: model.modelNumber, status: 'approved',
      });
    }
  });
}
