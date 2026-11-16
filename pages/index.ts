import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { LoginPage } from './LoginPage';
import { ParticipantApplicationPage } from './applicant/ParticipantApplicationPage';
import { ParticipantWorkbenchPage } from './participant/ParticipantWorkbenchPage';
import { MyDevicesPage } from './participant/MyDevicesPage';
import { RegisterModelPage } from './participant/RegisterModelPage';
import { WorkbenchPage } from './cer/WorkbenchPage';
import { ParticipantRegisterPage } from './cer/ParticipantRegisterPage';
import { ApplicationsQueuePage } from './cer/ApplicationsQueuePage';
import { ApplicationReviewPage } from './cer/ApplicationReviewPage';
import { DeviceRegisterPage } from './cer/DeviceRegisterPage';
import { ModelReviewPage } from './cer/ModelReviewPage';
import { RuleSetsPage } from './register/RuleSetsPage';
import { RecordInstallationPage } from './register/RecordInstallationPage';
import { RegisterUnitPage } from './register/RegisterUnitPage';
import { UnitPage } from './register/UnitPage';
import { RegisterSectionsPage } from './register/RegisterSectionsPage';
import { HistoryPanel } from './register/HistoryPanel';
import { UsersPanel } from './participant/UsersPanel';
import { MyAccountPage } from './participant/MyAccountPage';
import { IncidentsPage, ReportIncidentPage } from './incidents/IncidentsPage';
import { IncidentPage } from './incidents/IncidentPage';
import { RecallsPage, RecallPage } from './recalls/RecallPage';
import { ExchangePage, OutboxMessagePage, DeadLetterPage, ReconciliationRunPage } from './cer/ExchangePage';

export {
  BasePage, LoginPage, ParticipantApplicationPage,
  ParticipantWorkbenchPage, MyDevicesPage, RegisterModelPage,
  WorkbenchPage, ParticipantRegisterPage, ApplicationsQueuePage, ApplicationReviewPage,
  DeviceRegisterPage, ModelReviewPage,
  RuleSetsPage, RecordInstallationPage, RegisterUnitPage, UnitPage, RegisterSectionsPage, HistoryPanel,
  UsersPanel, MyAccountPage, IncidentsPage, ReportIncidentPage, IncidentPage,
  ExchangePage, OutboxMessagePage, DeadLetterPage, ReconciliationRunPage,
  RecallsPage, RecallPage,
};

/** Page objects for an applicant user, all bound to one page. */
export class ApplicantUser {
  readonly base: BasePage;
  readonly application: ParticipantApplicationPage;
  constructor(readonly page: Page) {
    this.base = new BasePage(page);
    this.application = new ParticipantApplicationPage(page);
  }
}

/** Page objects for a participant_admin / participant_user, all bound to one page. */
export class ParticipantUser {
  readonly base: BasePage;
  readonly workbench: ParticipantWorkbenchPage;
  readonly myDevices: MyDevicesPage;
  readonly registerModel: RegisterModelPage;
  constructor(readonly page: Page) {
    this.base = new BasePage(page);
    this.workbench = new ParticipantWorkbenchPage(page);
    this.myDevices = new MyDevicesPage(page);
    this.registerModel = new RegisterModelPage(page);
  }
}

/** Page objects for a cer_admin / cer_officer user, all bound to one page. */
export class CerUser {
  readonly base: BasePage;
  readonly workbench: WorkbenchPage;
  readonly register: ParticipantRegisterPage;
  readonly queue: ApplicationsQueuePage;
  readonly review: ApplicationReviewPage;
  readonly deviceRegister: DeviceRegisterPage;
  readonly modelReview: ModelReviewPage;
  constructor(readonly page: Page) {
    this.base = new BasePage(page);
    this.workbench = new WorkbenchPage(page);
    this.register = new ParticipantRegisterPage(page);
    this.queue = new ApplicationsQueuePage(page);
    this.review = new ApplicationReviewPage(page);
    this.deviceRegister = new DeviceRegisterPage(page);
    this.modelReview = new ModelReviewPage(page);
  }
}
