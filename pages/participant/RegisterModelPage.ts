import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';
import { DeviceModel } from '../../dynamic.data/device-model.builder';
import { reportIssue } from '../../utils/issues';

/**
 * Register a device model (/participant/devices/models/new).
 * Choosing a Device class loads its rule set ("Validating model attributes
 * against <class> rules vN") and renders that class's attribute fields inside
 * the "Class attributes" group. Classes without attributes show a JSON box ({}).
 */
export class RegisterModelPage extends BasePage {
  readonly main: Locator;
  readonly deviceClass: Locator;
  readonly modelNumber: Locator;
  readonly modelName: Locator;
  readonly effectiveDate: Locator;
  readonly rulesNotice: Locator;
  readonly classAttributes: Locator;
  readonly registerButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    // Field names include hint text; match on the stable prefix.
    this.deviceClass     = this.main.getByRole('combobox', { name: /^Device class/ });
    this.modelNumber     = this.main.getByRole('textbox', { name: /^Model number/ });
    this.modelName       = this.main.getByRole('textbox', { name: /^Model name/ });
    this.effectiveDate   = this.main.getByRole('textbox', { name: /^Effective date/ });
    this.rulesNotice     = this.main.getByText(/^Validating model attributes against/);
    this.classAttributes = this.main.getByRole('group', { name: /^Class attributes/ });
    this.registerButton  = this.main.getByRole('button', { name: 'Register model' });
  }

  private field(label: string) {
    return this.page.locator(`dt:text-is("${label}") + dd`);
  }

  /** Attribute input inside "Class attributes" whose label starts with the attribute name. */
  private attribute(name: string) {
    return this.classAttributes.getByLabel(new RegExp(`^${name}\\b`));
  }

  /** Registers the model and returns its CER model ID. New models start as pending. */
  async registerModel(model: DeviceModel): Promise<string> {
    return test.step(`Register ${model.deviceClass} model ${model.modelNumber}`, async () => {
      // Choosing a class loads its rules and re-renders the form - wait for the
      // rules notice before filling anything, or the inputs get replaced.
      await this.deviceClass.selectOption(model.deviceClass);
      await expect(this.rulesNotice).toBeVisible({ timeout: 15000 });
      await this.modelNumber.fill(model.modelNumber);
      await this.modelName.fill(model.modelName);
      // Effective date defaults to today - left as is

      for (const [name, value] of Object.entries(model.attributes)) {
        const input = this.attribute(name);
        if ((await input.evaluate(el => el.tagName)) === 'SELECT') await input.selectOption(String(value));
        else await input.fill(String(value));
      }
      test.info().annotations.push({ type: 'rules', description: (await this.rulesNotice.innerText()).trim() });

      await this.registerButton.click();

      // Outcome: the new model page, or a "Validation failed" alert (HTTP 422) listing
      // refused fields, e.g. "manufacturerId: a installer cannot register device models".
      // The URL switches to the new model first; the form stays (button disabled)
      // until the model detail has loaded - this can take several seconds.
      const heading = this.page.getByRole('heading', { level: 1, name: `${model.modelNumber} ${model.modelName}` });
      const refused = this.main.getByRole('alert').filter({ hasText: 'Validation failed' });
      await expect(heading.or(refused).first()).toBeVisible({ timeout: 30000 });
      if (await refused.isVisible()) {
        const reason = (await refused.innerText()).replace(/\s+/g, ' ').replace(/ Register model$/, '').trim();
        reportIssue(`Register ${model.deviceClass} model refused: ${reason}`);
        throw new Error(`Model registration refused by the app: ${reason}`);
      }
      await expect(this.main.getByText('pending', { exact: true })).toBeVisible();
      await expect(this.main.getByText('Awaiting CER approval')).toBeVisible();
      await expect(this.field('Device class')).toHaveText(model.deviceClass);
      for (const [name, value] of Object.entries(model.attributes)) {
        await expect(this.field(name)).toHaveText(String(value));
      }
      return (await this.field('Model ID').innerText()).trim();
    });
  }
}
