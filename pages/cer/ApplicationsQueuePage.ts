import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/**
 * CER applications queue (/cer/participants/applications).
 * Default "Show" filter is Open (submitted, under assessment, returned).
 * The queue has no search box: the application is located by its ABN cell
 * (ABN is unique) and the Type cell is then checked.
 */
export class ApplicationsQueuePage extends BasePage {
  readonly table: Locator;
  readonly status: Locator;

  constructor(page: Page) {
    super(page);
    this.table = page.getByRole('main').getByRole('table');
    this.status = page.getByRole('search', { name: 'Filter applications' }).getByRole('status');
  }

  row(abn: string) {
    return this.table.getByRole('row').filter({ has: this.page.getByRole('cell', { name: abn, exact: true }) });
  }

  async openApplication(abn: string, expectedType?: string) {
    await test.step(`Open application ABN ${abn}${expectedType ? ` (${expectedType})` : ''}`, async () => {
      // List loads slowly - wait for the "<n> applications" count
      await expect(this.status).toContainText(/\d+ applications?/, { timeout: 30000 });
      const row = this.row(abn);
      await expect(row, `Application with ABN ${abn} not found in queue`).toHaveCount(1);
      if (expectedType) await expect(row.getByRole('cell', { name: expectedType, exact: true })).toBeVisible();
      await row.getByRole('link').first().click();
      await expect(this.page.locator('dt:text-is("ABN") + dd')).toHaveText(abn, { timeout: 30000 });
    });
  }
}
