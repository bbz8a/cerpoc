import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';
import { ApplicationIdentifiers } from '../../types/organisation';

export type Decision = 'Approve' | 'Return for correction' | 'Reject';

/** CER review of a single participant application. */
export class ApplicationReviewPage extends BasePage {
  readonly main: Locator;
  readonly assessmentNote: Locator;
  readonly addNoteButton: Locator;
  readonly reason: Locator;
  readonly recordDecisionButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.assessmentNote = page.getByRole('textbox', { name: 'Add assessment note' });
    // NOTE: the original recording captured the note control together with the
    // typed text ("Add assessment noteName: AUTO..."). After a note is added the
    // input is replaced by a fresh empty one so another note can be added - never
    // locate it by note text. The UI now has an explicit "Add note" button,
    // disabled until text is entered. Revisit when the UI is stable.
    this.addNoteButton = page.getByRole('button', { name: 'Add note' });
    this.reason = page.getByRole('textbox', { name: /^Reason/ });
    this.recordDecisionButton = page.getByRole('button', { name: 'Record decision' });
  }

  async expectLoaded() {
    await super.expectLoaded();
    await expect(this.main.getByRole('heading', { level: 2, name: 'Assessment notes' })).toBeVisible();
    await expect(this.assessmentNote).toBeVisible();
  }

  private field(label: string) {
    return this.page.locator(`dt:text-is("${label}") + dd`);
  }

  async readIdentifiers(): Promise<ApplicationIdentifiers> {
    return test.step('Read application identifiers', async () => {
      const legalName = (await this.field('Legal name').innerText()).trim();
      if (!legalName) throw new Error('Legal name is missing');
      return {
        legalName,
        address: await this.field('Address').innerText(),
        applicationId: await this.field('Application ID').innerText(),
        participantId: await this.field('Participant ID').innerText(),
      };
    });
  }

  async addAssessmentNote(text: string) {
    await test.step('Add assessment note', async () => {
      await this.assessmentNote.fill(text);
      await this.addNoteButton.click();
      // Note appears in the Assessment notes list; the input is reset
      await expect(this.main.getByText(text.split('\n')[0])).toBeVisible();
      await expect(this.assessmentNote).toHaveValue('');
    });
  }

  async decide(decision: Decision, reason: string) {
    await test.step(`Record decision: ${decision}`, async () => {
      await this.page.getByRole('radio', { name: decision }).check();
      await this.reason.fill(reason);
      await this.recordDecisionButton.click();
      if (decision === 'Approve') {
        await expect(this.field('Decision')).toHaveText('approved');
      }
      await expect(this.field('Decision reason')).toHaveText(reason);
    });
  }
}
