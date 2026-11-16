import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export type ModelStatusChange = 'Approve' | 'Withdraw';

/** CER view of a single device model (/cer/register/models/<id>). */
export class ModelReviewPage extends BasePage {
  readonly main: Locator;
  readonly changeStatusToggle: Locator;
  readonly newStatus: Locator;
  readonly reason: Locator;
  readonly applyButton: Locator;
  readonly registerUnitLink: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    // Collapsed <details>; its summary reads "Change model status"
    this.changeStatusToggle = this.main.getByText('Change model status', { exact: true });
    this.newStatus = this.main.getByRole('combobox', { name: /^New status/ });
    this.reason = this.main.getByRole('textbox', { name: /^Reason/ });
    this.applyButton = this.main.getByRole('button', { name: 'Apply' });
    this.registerUnitLink = this.main.getByRole('link', { name: 'Register unit of this model' });
  }

  private field(label: string) {
    return this.page.locator(`dt:text-is("${label}") + dd`);
  }

  /** Status badge next to the model heading. */
  status(text: string) {
    return this.main.getByText(text, { exact: true }).first();
  }

  async expectDetails(expected: { modelId: string; manufacturer: string; status: string }) {
    await test.step('Verify model details', async () => {
      await expect(this.field('Model ID')).toHaveText(expected.modelId);
      await expect(this.field('Manufacturer')).toHaveText(expected.manufacturer);
      await expect(this.status(expected.status)).toBeVisible();
    });
  }

  async changeStatus(change: ModelStatusChange, reason: string) {
    await test.step(`Change model status: ${change}`, async () => {
      if (!(await this.newStatus.isVisible())) await this.changeStatusToggle.click();
      await this.newStatus.selectOption({ label: change });
      await this.reason.fill(reason); // recorded in the audit log
      await this.applyButton.click();
      if (change === 'Approve') {
        await expect(this.status('approved')).toBeVisible({ timeout: 30000 });
        await expect(this.status('pending')).toBeHidden();
        // Units can only be registered against an approved model
        await expect(this.registerUnitLink).toBeVisible();
      }
    });
  }
}
