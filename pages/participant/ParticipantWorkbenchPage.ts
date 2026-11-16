import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/** Participant workbench (/participant) - landing page for participant_admin / participant_user. */
export class ParticipantWorkbenchPage extends BasePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly myDevicesLink: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Participant workbench' });
    this.myDevicesLink = this.main.getByRole('link', { name: 'My devices' });
  }

  /** "Signed in as <user> for <organisation> <status>." */
  async expectActingFor(legalName: string, status = 'approved') {
    await test.step(`Verify acting for ${legalName} (${status})`, async () => {
      await expect(this.heading).toBeVisible();
      const signedInAs = this.main.getByText(/^Signed in as/);
      await expect(signedInAs.getByRole('strong')).toHaveText(legalName);
      await expect(signedInAs).toContainText(status);
    });
  }

  async openMyDevices() {
    await test.step('Open My devices', async () => {
      await this.myDevicesLink.click();
      await expect(this.page.getByRole('heading', { level: 1, name: 'My devices' })).toBeVisible();
    });
  }
}
