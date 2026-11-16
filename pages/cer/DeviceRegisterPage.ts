import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export type ModelStatus = 'pending' | 'approved' | 'withdrawn';

/** CER Device register (/cer/register) - Units / Models / Installations / Rejected submissions tabs. */
export class DeviceRegisterPage extends BasePage {
  readonly navLink: Locator;
  readonly modelsTab: Locator;
  readonly searchForm: Locator;
  readonly search: Locator;
  readonly statusFilter: Locator;
  readonly searchButton: Locator;
  readonly results: Locator;

  constructor(page: Page) {
    super(page);
    this.navLink = this.nav.getByRole('link', { name: 'Device register' });
    this.modelsTab = page.getByRole('navigation', { name: 'Register sections' }).getByRole('button', { name: 'Models' });
    this.searchForm = page.getByRole('search', { name: 'Search and filter the register' });
    this.search = this.searchForm.getByRole('searchbox', { name: 'Search', exact: true });
    this.statusFilter = this.searchForm.getByRole('combobox', { name: /^Status/ });
    this.searchButton = this.searchForm.getByRole('button', { name: 'Search' });
    this.results = page.getByRole('region', { name: 'Results' });
  }

  async openModels() {
    await test.step('Open Device register - Models', async () => {
      await this.navLink.click();
      await expect(this.page.getByRole('heading', { level: 1, name: 'Device register' })).toBeVisible();
      await this.modelsTab.click();
      await expect(this.modelsTab).toHaveAttribute('aria-pressed', 'true');
    });
  }

  /** Typing does not filter - Search must be clicked. */
  async searchModels(text: string, status?: ModelStatus) {
    await test.step(`Search models "${text}"${status ? ` (${status})` : ''}`, async () => {
      await this.search.fill(text);
      if (status) await this.statusFilter.selectOption(status);
      await this.searchButton.click();
      // Search can take well over 5s ("Searching…" / "Loading…")
      await expect(this.page.getByText('Searching…')).toBeHidden({ timeout: 30000 });
    });
  }

  modelRow(modelNumber: string) {
    return this.results.getByRole('row').filter({ has: this.page.getByRole('link', { name: modelNumber, exact: true }) });
  }

  async expectModelStatus(modelNumber: string, status: ModelStatus) {
    await test.step(`Verify model ${modelNumber} is ${status}`, async () => {
      await this.searchModels(modelNumber);
      await expect(this.modelRow(modelNumber)).toHaveCount(1);
      await expect(this.modelRow(modelNumber).getByRole('cell', { name: status, exact: true })).toBeVisible();
    });
  }

  async openModel(modelNumber: string) {
    await test.step(`Open model ${modelNumber}`, async () => {
      await expect(this.modelRow(modelNumber), `Model ${modelNumber} not found`).toHaveCount(1);
      await this.modelRow(modelNumber).getByRole('link', { name: modelNumber, exact: true }).click();
      await expect(this.page.getByRole('heading', { level: 1, name: new RegExp(`^${escapeRegExp(modelNumber)} `) })).toBeVisible({ timeout: 30000 });
    });
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
