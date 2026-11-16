import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/** My devices (/participant/devices) - the participant's own models, units and installations. */
export class MyDevicesPage extends BasePage {
  readonly registerModelLink: Locator;
  readonly registerUnitLink: Locator;
  readonly recordInstallationLink: Locator;

  constructor(page: Page) {
    super(page);
    const main = page.getByRole('main');
    this.registerModelLink = main.getByRole('link', { name: 'Register model' });
    this.registerUnitLink = main.getByRole('link', { name: 'Register unit' });
    this.recordInstallationLink = main.getByRole('link', { name: 'Record installation' });
  }

  async openRegisterModel() {
    await test.step('Open Register model', async () => {
      await this.registerModelLink.click();
      await expect(this.page.getByRole('heading', { level: 1, name: 'Register a device model' })).toBeVisible();
    });
  }
}
