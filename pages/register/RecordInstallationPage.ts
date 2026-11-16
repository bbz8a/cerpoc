import { Page, Locator, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export interface Installation {
  serial: string;
  nmi: string;
  /** grid_connected: true / false, or undefined to leave it unset ("—") */
  gridConnected?: boolean;
  address?: { line1: string; suburb: string; state: string; postcode: string };
}

/**
 * Record an installation (/cer/register/installations/new and
 * /participant/devices/installations/new). Choosing a unit loads the class rule
 * set ("Validating installation attributes against <class> rules vN ...") and
 * renders the class attributes (mounting, grid_connected, export_limit_kw).
 * The CER form also has an Installer combobox.
 */
export class RecordInstallationPage extends BasePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly unit: Locator;
  readonly installer: Locator;
  readonly nmi: Locator;
  readonly rulesNotice: Locator;
  readonly classAttributes: Locator;
  readonly gridConnected: Locator;
  readonly submitButton: Locator;
  readonly refusal: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Record an installation' });
    this.unit = this.main.getByRole('combobox', { name: /^Unit/ });
    this.installer = this.main.getByRole('combobox', { name: /^Installer/ });
    this.nmi = this.main.getByRole('textbox', { name: /^NMI/ });
    this.rulesNotice = this.main.getByText(/^Validating installation attributes against/);
    this.classAttributes = this.main.getByRole('group', { name: /^Class attributes/ });
    this.gridConnected = this.classAttributes.getByRole('combobox', { name: /^grid_connected/ });
    this.submitButton = this.main.getByRole('button', { name: 'Record installation' });
    this.refusal = this.main.getByRole('alert');
  }

  async open() {
    await this.main.getByRole('link', { name: 'Record installation' }).click();
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
  }

  /** Unit option labels ("<serial> — <model> (<owner>)"), placeholder excluded. */
  async unitOptions(): Promise<string[]> {
    await expect(this.unit.locator('option').nth(1)).toBeAttached({ timeout: 30_000 });
    return (await this.unit.locator('option').allTextContents()).map(t => t.trim()).filter(t => !/^Select/.test(t));
  }

  /** Fills the form (does not submit). Returns the rules notice text. */
  async fill(i: Installation): Promise<string> {
    return test.step(`Fill installation of ${i.serial} at NMI ${i.nmi}`, async () => {
      const option = this.unit.locator('option', { hasText: i.serial }).first();
      await expect(option).toBeAttached({ timeout: 30_000 });
      await this.unit.selectOption((await option.getAttribute('value'))!);
      await expect(this.rulesNotice).toBeVisible({ timeout: 15_000 });
      // CER only: the installer list is capped (~25, alphabetical) - any approved installer will do.
      if (await this.installer.isVisible()) await this.installer.selectOption({ index: 1 });
      await this.nmi.fill(i.nmi);
      const a = i.address ?? { line1: '1 Test Street', suburb: 'Melbourne', state: 'VIC', postcode: '3000' };
      const site = this.main.getByRole('group', { name: 'Site address' });
      await site.getByRole('textbox', { name: /^Address line 1/ }).fill(a.line1);
      await site.getByRole('textbox', { name: /^Suburb/ }).fill(a.suburb);
      await site.getByRole('combobox', { name: /^State/ }).selectOption(a.state);
      await site.getByRole('textbox', { name: /^Postcode/ }).fill(a.postcode);
      await this.gridConnected.selectOption({ label: i.gridConnected === undefined ? '—' : i.gridConnected ? 'yes' : 'no' });
      return (await this.rulesNotice.innerText()).trim();
    });
  }

  async submit() {
    await this.submitButton.click();
  }

  /** Submits and waits for the new installation page; returns its CER-I ID. */
  async submitExpectRecorded(): Promise<string> {
    return test.step('Record installation', async () => {
      await this.submit();
      const recorded = this.page.waitForURL(u => /\/installations\/(?!new)/.test(u.pathname), { timeout: 60_000 }).then(() => true);
      const refused = this.refusal.waitFor({ timeout: 60_000 }).then(() => false);
      if (!(await Promise.race([recorded, refused]))) {
        throw new Error(`Installation refused: ${(await this.refusal.innerText()).replace(/\s+/g, ' ')}`);
      }
      const id = decodeURIComponent(this.page.url()).match(/CER-I-[0-9A-Z]+/)?.[0]
        ?? (await this.main.getByText(/^CER-I-[0-9A-Z]+$/).first().innerText()).trim();
      expect(id).toMatch(/^CER-I-/);
      return id;
    });
  }
}
