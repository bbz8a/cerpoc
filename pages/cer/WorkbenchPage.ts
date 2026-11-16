import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/**
 * CER area (cer_admin / cer_officer). Landing page is now the
 * "Executive dashboard" (/cer); "CER workbench" is a separate nav link.
 */
export class WorkbenchPage extends BasePage {
  readonly participantsNavLink: Locator;

  constructor(page: Page) {
    super(page);
    this.participantsNavLink = this.nav.getByRole('link', { name: 'Participants' });
  }

  async expectLoaded() {
    await super.expectLoaded();
    await expect(this.sidebar).toContainText('Clean Energy Regulator');
  }

  async openParticipants() {
    await test.step('Open participants', async () => {
      await this.participantsNavLink.click();
      await expect(this.page.getByRole('heading', { level: 1, name: 'Participants' })).toBeVisible();
    });
  }
}
