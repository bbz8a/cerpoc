import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';
import { OrganisationDetails } from '../../types/organisation';
import { reportIssue } from '../../utils/issues';

export interface CurrentApplication {
  legalName: string;
  /** Submitted and waiting in the CER queue. */
  pending: boolean;
}

/**
 * Applicant workbench (/applicant).
 * The top of the page shows the applicant's current application (if any).
 * Below it is either "Start a new application", a blank "New application"
 * form, or the editable "Application details" of a draft.
 */
export class ParticipantApplicationPage extends BasePage {
  readonly main: Locator;
  readonly awaitingAssessment: Locator;
  readonly startNewButton: Locator;
  readonly legalName: Locator;
  readonly tradingName: Locator;
  readonly abn: Locator;
  readonly participantType: Locator;
  readonly contactName: Locator;
  readonly email: Locator;
  readonly phone: Locator;
  readonly addressLine1: Locator;
  readonly addressLine2: Locator;
  readonly suburb: Locator;
  readonly state: Locator;
  readonly postcode: Locator;
  readonly declAuthorised: Locator;
  readonly declAccurate: Locator;
  readonly evidenceNotes: Locator;
  readonly saveDraftButton: Locator;
  readonly submitButton: Locator;
  readonly conflictAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.awaitingAssessment = this.main.getByText('Your application is in the CER queue awaiting assessment');
    this.startNewButton = this.main.getByRole('button', { name: 'Start a new application' });
    this.legalName       = page.getByRole('textbox', { name: 'Legal name' });
    this.tradingName     = page.getByRole('textbox', { name: 'Trading name (optional)' });
    this.abn             = page.getByRole('textbox', { name: 'ABN 11 digits' });
    // Combobox labels can render with their options appended; match on the stable prefix.
    this.participantType = page.getByRole('combobox', { name: /^Participant type/ });
    this.contactName     = page.getByRole('textbox', { name: 'Contact name' });
    this.email           = page.getByRole('textbox', { name: 'Email' });
    this.phone           = page.getByRole('textbox', { name: 'Phone' });
    this.addressLine1    = page.getByRole('textbox', { name: 'Address line 1' });
    this.addressLine2    = page.getByRole('textbox', { name: 'Address line 2 (optional)' });
    this.suburb          = page.getByRole('textbox', { name: 'Suburb' });
    this.state           = page.getByRole('combobox', { name: /^State/ });
    this.postcode        = page.getByRole('textbox', { name: 'Postcode' });
    this.declAuthorised  = page.getByRole('checkbox', { name: 'I am authorised to apply on' });
    this.declAccurate    = page.getByRole('checkbox', { name: 'The information provided is' });
    this.evidenceNotes   = page.getByRole('textbox', { name: 'Evidence notes (optional)' });
    this.saveDraftButton = page.getByRole('button', { name: 'Save draft' });
    this.submitButton    = page.getByRole('button', { name: 'Submit to CER' });
    this.conflictAlert   = this.main.getByRole('alert').filter({ hasText: 'Conflict' });
  }

  /** Reads the application summary at the top of the workbench, if one exists. */
  async readCurrentApplication(): Promise<CurrentApplication | null> {
    return test.step('Detect current application', async () => {
      await expect(this.legalName.or(this.startNewButton).first()).toBeVisible();
      const heading = this.main.getByRole('heading', { level: 2 }).first();
      const title = (await heading.innerText()).trim();
      if (title === 'New application') return null; // blank form - nothing in progress
      return { legalName: title, pending: await this.awaitingAssessment.isVisible() };
    });
  }

  /**
   * Shows the application form. Clicks "Start a new application" when offered;
   * otherwise the blank form (or an existing draft) is already shown.
   */
  async openForm() {
    await test.step('Open application form', async () => {
      if (await this.startNewButton.isVisible()) await this.startNewButton.click();
      await expect(this.legalName).toBeEditable();
    });
  }

  async fillOrganisation(org: OrganisationDetails) {
    await test.step('Fill organisation details', async () => {
      await this.legalName.fill(org.legal_name);
      await this.tradingName.fill(org.trading_name ?? '');
      await this.abn.fill(org.abn);
      await this.participantType.selectOption(org.participant_type);
      await this.contactName.fill(org.contact_name);
      await this.email.fill(org.email);
      await this.phone.fill(org.phone);
      await this.addressLine1.fill(org.address_line_1);
      await this.addressLine2.fill(org.address_line_2 ?? '');
      await this.suburb.fill(org.suburb);
      await this.state.selectOption(org.state);
      // Postcode must match the state's main city (see dynamic.data/generate.ts)
      await this.postcode.fill(org.postcode);
    });
  }

  async confirmDeclarations() {
    await test.step('Confirm declarations', async () => {
      await this.declAuthorised.check();
      await this.declAccurate.check();
    });
  }

  async addEvidence(note: string) {
    await test.step('Add evidence note', async () => {
      await this.evidenceNotes.fill(note);
    });
  }

  /**
   * Waits for the outcome of Save draft / Submit: either the application summary
   * for legalName, or the server's Conflict alert ("You already have an
   * application in progress"). A Conflict is REPORTED as an issue (the screen
   * says a new application is allowed) and returns false - it does not fail the test.
   */
  private async outcome(legalName: string, action: string): Promise<boolean> {
    const summary = this.main.getByRole('heading', { level: 2, name: legalName });
    await expect(summary.or(this.conflictAlert).first()).toBeVisible({ timeout: 15000 });
    if (await this.conflictAlert.isVisible()) {
      reportIssue(`${action} rejected for "${legalName}": ${(await this.conflictAlert.innerText()).replace(/\s+/g, ' ')}`);
      return false;
    }
    return true;
  }

  /** Saves without submitting. Returns false if the server rejected it (reported as an issue). */
  async saveDraft(legalName: string): Promise<boolean> {
    return test.step('Save draft', async () => {
      await this.saveDraftButton.click();
      if (!(await this.outcome(legalName, 'Save draft'))) return false;
      await expect(this.main.getByText('draft', { exact: true })).toBeVisible();
      return true;
    });
  }

  /** Submits to CER. Returns false if the server rejected it (reported as an issue). */
  async submitToCer(legalName: string): Promise<boolean> {
    return test.step('Submit to CER', async () => {
      await this.submitButton.click();
      if (!(await this.outcome(legalName, 'Submit to CER'))) return false;
      await expect(this.main.getByText('submitted', { exact: true })).toBeVisible();
      await expect(this.awaitingAssessment).toBeVisible();
      return true;
    });
  }
}
