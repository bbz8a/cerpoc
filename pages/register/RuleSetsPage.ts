import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/**
 * Device class rule sets (/cer/register/rules). One h2 per device class
 * ("<Display name> <code>") followed by its version table: Version | In force |
 * Published | Reason | Definition (details "schema & duplicate keys" holding the JSON).
 */
export class RuleSetsPage extends BasePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly newDeviceClassButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Device class rule sets' });
    this.newDeviceClassButton = this.main.getByRole('button', { name: 'New device class' });
  }

  async open() {
    await test.step('Open Device register > Rule sets', async () => {
      await this.nav.getByRole('link', { name: 'Device register' }).click();
      await this.main.getByRole('link', { name: 'Rule sets' }).click();
      await expect(this.heading).toBeVisible({ timeout: 30_000 });
    });
  }

  classHeading(code: string): Locator {
    return this.main.getByRole('heading', { level: 2 }).filter({ has: this.page.locator(`code:text-is("${code}")`) });
  }

  versionTable(code: string): Locator {
    return this.classHeading(code).locator('xpath=following::table[1]');
  }

  /** Row of one version, e.g. versionRow('battery', 'v2'). */
  versionRow(code: string, version: string): Locator {
    return this.versionTable(code).getByRole('row').filter({ has: this.page.getByRole('cell', { name: version, exact: true }) });
  }

  /** Expands "schema & duplicate keys" of a version and returns its JSON text. */
  async definition(code: string, version: string): Promise<string> {
    const details = this.versionRow(code, version).locator('details');
    await details.locator('summary').click();
    return (await details.innerText()).replace(/\s+/g, ' ');
  }

  /** Opens the "New device class" form, checks it, then cancels (publishing adds a permanent row). */
  async checkNewDeviceClassForm() {
    await test.step('New device class form opens (cancelled - publishing is permanent)', async () => {
      await this.newDeviceClassButton.click();
      const form = this.main.getByRole('heading', { level: 2, name: 'New device class' });
      await expect(form).toBeVisible();
      await expect(this.main.getByRole('button', { name: 'Publish version' })).toBeVisible();
      await this.main.getByRole('button', { name: 'Cancel' }).click();
      await expect(form).toBeHidden();
    });
  }
}
