import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/** Register a unit (/participant/devices/units/new, /cer/register/units/new). */
export class RegisterUnitPage extends BasePage {
  readonly main: Locator;
  readonly model: Locator;
  readonly serial: Locator;
  readonly batch: Locator;
  readonly classAttributes: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.model = this.main.getByRole('combobox', { name: /^Model/ });
    this.serial = this.main.getByRole('textbox', { name: /^Serial number/ });
    this.batch = this.main.getByRole('textbox', { name: /^Batch/ });
    this.classAttributes = this.main.getByRole('group', { name: /^Class attributes/ });
    this.submitButton = this.main.getByRole('button', { name: 'Register unit' });
  }

  async open() {
    await this.main.getByRole('link', { name: 'Register unit' }).click();
    await expect(this.serial).toBeVisible({ timeout: 30_000 });
  }

  /** Model options offered (placeholder excluded); allows a few seconds for them to load. */
  async modelOptions(): Promise<string[]> {
    await expect(this.model.locator('option').nth(1)).toBeAttached({ timeout: 10_000 }).catch(() => {});
    return (await this.model.locator('option').allTextContents()).map(t => t.trim()).filter(t => !/^Select/.test(t));
  }

  /** Registers a unit of the model whose option contains modelNumber; returns the CER-D ID. */
  async register(modelNumber: string, serial: string, attributes: Record<string, string | number>): Promise<string> {
    return test.step(`Register unit ${serial} of ${modelNumber}`, async () => {
      const option = this.model.locator('option', { hasText: modelNumber }).first();
      await this.model.selectOption((await option.getAttribute('value'))!);
      await this.serial.fill(serial);
      await this.batch.fill(`E2E-${serial}`);
      for (const [name, value] of Object.entries(attributes)) {
        await this.classAttributes.getByLabel(new RegExp(`^${name}\\b`)).fill(String(value));
      }
      await this.submitButton.click();
      await this.page.waitForURL(u => /\/units\/(?!new)/.test(u.pathname), { timeout: 60_000 });
      return decodeURIComponent(this.page.url()).match(/CER-D-[0-9A-Z]+/)![0];
    });
  }
}
