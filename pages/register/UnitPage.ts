import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/** Unit detail (.../units/<CER-D-...>): heading "Serial <serial>", dt/dd fields, Transfer ownership panel. */
export class UnitPage extends BasePage {
  readonly main: Locator;
  readonly transferPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.transferPanel = this.main.locator('details', { hasText: 'Transfer ownership' });
  }

  field(label: string): Locator {
    return this.main.locator(`dt:text-is("${label}") + dd`);
  }

  async expectUnit(serial: string, unitId: string) {
    await expect(this.main.getByRole('heading', { level: 1, name: new RegExp(`Serial ${serial}`) })).toBeVisible({ timeout: 30_000 });
    await expect(this.field('Unit ID')).toHaveText(unitId);
  }

  /**
   * Transfers the unit. Participant view: free-text participant ID. CER view: "New owner" select of
   * approved participants, matched by option value = participantId or option text ~ ownerName.
   * Returns false (nothing submitted) when the select does not offer the new owner.
   */
  async transferTo(participantId: string, reason: string, ownerName?: RegExp): Promise<boolean> {
    return test.step(`Transfer ownership to ${participantId}`, async () => {
      await this.transferPanel.locator('summary').click();
      const idBox = this.transferPanel.getByRole('textbox', { name: /^New owner participant ID/ });
      const ownerSelect = this.transferPanel.getByRole('combobox', { name: /^New owner/ });
      await expect(idBox.or(ownerSelect)).toBeVisible();
      if (await idBox.isVisible()) {
        await idBox.fill(participantId);
      } else {
        const options = await ownerSelect.locator('option').evaluateAll(os =>
          os.map(o => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })));
        const match = options.find(o => o.value === participantId || (!!ownerName && ownerName.test(o.text)));
        if (!match) return false;
        await ownerSelect.selectOption(match.value);
      }
      await this.transferPanel.getByRole('textbox', { name: /^Evidence reference/ }).fill(`E2E-${Date.now()}`);
      await this.transferPanel.getByRole('textbox', { name: /^Reason/ }).fill(reason);
      await this.transferPanel.getByRole('button', { name: 'Transfer' }).click();
      return true;
    });
  }
}
