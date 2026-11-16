import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export type RegisterSection = 'Units' | 'Models' | 'Installations' | 'Rejected submissions';

/**
 * Device register (CER, /cer/register) and My devices (participant, /participant/devices):
 * section buttons Units | Models | Installations | Rejected submissions, and a results table.
 * Rejected submissions columns: When | Kind | Class / rules | Participant | Submitted by | Reasons
 * (the Reasons cell holds the reason list and a "payload" details). Newest first.
 */
export class RegisterSectionsPage extends BasePage {
  readonly main: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
  }

  async openSection(name: RegisterSection) {
    await test.step(`Open ${name}`, async () => {
      const button = this.main.getByRole('button', { name, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    });
  }

  /** Data rows of the results table (header excluded). */
  rows(): Locator {
    return this.main.getByRole('table').last().locator('tbody tr');
  }

  /** Rejection rows whose text matches all patterns; first = newest. */
  rejections(...patterns: RegExp[]): Locator {
    let rows = this.rows();
    for (const p of patterns) rows = rows.filter({ hasText: p });
    return rows;
  }

  /** Expands a row's payload and returns its text. */
  async payload(row: Locator): Promise<string> {
    const details = row.locator('details', { hasText: 'payload' });
    await details.locator('summary').click();
    return (await details.innerText()).replace(/\s+/g, ' ');
  }
}
