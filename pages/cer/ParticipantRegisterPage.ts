import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export type ParticipantStatus = 'pending' | 'approved' | 'suspended' | 'rejected' | 'withdrawn';

/** Participant register (/cer/participants) - search and status of organisations. */
export class ParticipantRegisterPage extends BasePage {
  readonly searchForm: Locator;
  readonly search: Locator;
  readonly statusFilter: Locator;
  readonly searchButton: Locator;
  readonly searching: Locator;
  readonly rows: Locator;
  readonly applicationsQueueLink: Locator;

  constructor(page: Page) {
    super(page);
    this.searchForm = page.getByRole('search', { name: 'Search participants' });
    this.search = this.searchForm.getByRole('textbox', { name: 'Search' });
    this.statusFilter = this.searchForm.getByRole('combobox', { name: /^Status/ });
    this.searchButton = this.searchForm.getByRole('button', { name: 'Search' });
    this.searching = page.getByText('Searching…');
    this.rows = page.locator('tbody tr');
    this.applicationsQueueLink = page.getByRole('link', { name: 'Open the applications queue' });
  }

  /** Typing no longer filters - the Search button must be clicked. */
  async searchFor(text: string, status?: ParticipantStatus) {
    await test.step(`Search participants "${text}"${status ? ` (${status})` : ''}`, async () => {
      await this.search.fill(text);
      if (status) await this.statusFilter.selectOption(status);
      await this.searchButton.click();
      await expect(this.searching).toBeHidden({ timeout: 30000 });
    });
  }

  /**
   * Searches by ABN (unique) and checks the single returned row: status and,
   * if given, type. Name is not used as a filter.
   */
  async expectStatus(abn: string, status: ParticipantStatus, expectedType?: string) {
    await test.step(`Verify ABN ${abn} is ${status}${expectedType ? ` (${expectedType})` : ''}`, async () => {
      await this.searchFor(abn);
      await expect(this.rows).toHaveCount(1);
      const row = this.rows.first();
      await expect(row.getByRole('cell', { name: abn, exact: true })).toBeVisible();
      if (expectedType) await expect(row.getByRole('cell', { name: expectedType, exact: true })).toBeVisible();
      // Status is displayed upper-case via CSS; match case-insensitively
      await expect(row.getByRole('cell', { name: new RegExp(`^${status}$`, 'i') })).toBeVisible();
    });
  }

  /** Legal name of the first participant in the current results (first column link). */
  async firstLegalName(): Promise<string> {
    const link = this.rows.first().getByRole('cell').first().getByRole('link');
    await expect(link, 'No participant matched the search').toBeVisible();
    return (await link.innerText()).trim();
  }

  async openApplicationsQueue() {
    await test.step('Open applications queue', async () => {
      // NOTE: the queue cannot be searched by ABN or organisation name
      await this.applicationsQueueLink.click();
      await expect(this.page.getByRole('heading', { level: 1, name: 'Participant applications' })).toBeVisible();
    });
  }
}
