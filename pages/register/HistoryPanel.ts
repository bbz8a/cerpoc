import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export interface HistoryRow {
  version: string;     // "v3"
  rowId: number;       // 10 (history.device_versions row id)
  corrects?: number;   // "corrects #14"
  supersededBy?: number; // True until = "superseded by #15"
  text: string;        // whole row, whitespace-collapsed
}

export interface Correction {
  rowId: number;
  field: 'serial' | 'batch' | 'ownerParticipantId' | 'attributes';
  value: string;
  reason: string;
  evidence?: string;
}

/**
 * "History" details on a unit / installation / model page (history.device_versions).
 * Columns: Version | Row id | Status | ... | True from | True until | Recorded | Changed by | Source | Reason | Evidence | Changes.
 * Below the table: "Reconstruct at a point in time" (As of / As known at -> Show, GET .../at)
 * and, for CER only, "Correct a version".
 */
export class HistoryPanel extends BasePage {
  readonly panel: Locator;
  readonly table: Locator;
  readonly asOf: Locator;
  readonly knownAt: Locator;
  readonly showButton: Locator;
  readonly versionToCorrect: Locator;
  readonly correctField: Locator;
  readonly correctValue: Locator;
  readonly correctReason: Locator;
  readonly correctEvidence: Locator;
  readonly recordCorrectionButton: Locator;

  constructor(page: Page) {
    super(page);
    const main = page.getByRole('main');
    this.panel = main.locator('details', { has: page.locator('summary', { hasText: /^History$/ }) });
    this.table = this.panel.getByRole('table');
    this.asOf = this.panel.getByLabel(/^As of/);
    this.knownAt = this.panel.getByLabel(/^As known at/);
    this.showButton = this.panel.getByRole('button', { name: 'Show' });
    this.versionToCorrect = this.panel.getByLabel(/^Version to correct/);
    this.correctField = this.panel.getByLabel(/^Field/);
    this.correctValue = this.panel.getByLabel(/^Correct value/);
    this.correctReason = this.panel.getByLabel(/^Reason/);
    this.correctEvidence = this.panel.getByLabel(/^Evidence reference/);
    this.recordCorrectionButton = this.panel.getByRole('button', { name: 'Record correction' });
  }

  async open() {
    await test.step('Expand History', async () => {
      if (!(await this.panel.evaluate(d => (d as HTMLDetailsElement).open))) await this.panel.locator('summary').first().click();
      await expect(this.table.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    });
  }

  /** Parsed history rows, newest first as displayed. */
  async rows(): Promise<HistoryRow[]> {
    const cells = await this.table.locator('tbody tr').evaluateAll(trs =>
      trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').replace(/\s+/g, ' ').trim())));
    return cells.map(c => {
      const all = c.join(' | ');
      const num = (re: RegExp) => { const m = all.match(re); return m ? Number(m[1]) : undefined; };
      return {
        version: c[0],
        rowId: Number(c[1].match(/#(\d+)/)?.[1]),
        corrects: num(/corrects #(\d+)/),
        supersededBy: num(/superseded by #(\d+)/),
        text: all,
      };
    });
  }

  row(rowId: number): Locator {
    return this.table.locator('tbody tr').filter({ has: this.page.locator('td code', { hasText: new RegExp(`^#${rowId}$`) }) });
  }

  /**
   * Reconstructs the record as of a time, optionally as known at a time (datetime-local "YYYY-MM-DDTHH:mm",
   * blank = now). Returns the GET .../at status and the rendered result text.
   */
  async reconstruct(asOf: string, knownAt = ''): Promise<{ status: number; text: string }> {
    return test.step(`Reconstruct as of ${asOf}, known at ${knownAt || 'now'}`, async () => {
      await this.asOf.fill(asOf);
      await this.knownAt.fill(knownAt);
      const [res] = await Promise.all([
        this.page.waitForResponse(r => /\/at\?/.test(r.url()) && r.request().method() === 'GET', { timeout: 90_000 }),
        this.showButton.click(),
      ]);
      await expect(this.panel.getByText('Loading…')).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
      const all = (await this.panel.innerText()).replace(/\s+/g, ' ');
      const start = all.indexOf('Show') + 4;
      const end = all.indexOf('Correct a version');
      return { status: res.status(), text: all.slice(start, end > start ? end : undefined).trim() };
    });
  }

  /** Version options offered for correction (row ids). */
  /** Expands the nested "Correct a version" details (collapsed by default). */
  async openCorrection() {
    const correction = this.panel.locator('details', { has: this.page.locator('summary', { hasText: 'Correct a version' }) });
    if (!(await correction.evaluate(d => (d as HTMLDetailsElement).open))) await correction.locator('summary').first().click();
    await expect(this.versionToCorrect).toBeVisible();
  }

  async correctableRowIds(): Promise<number[]> {
    await this.openCorrection();
    const values = await this.versionToCorrect.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
    return values.filter(v => v).map(Number);
  }

  /** Fills and submits "Correct a version"; returns the POST response (null if nothing was sent). */
  async correct(c: Correction): Promise<Response | null> {
    return test.step(`Correct #${c.rowId}: ${c.field} = ${c.value}`, async () => {
      await this.openCorrection();
      await this.versionToCorrect.selectOption(String(c.rowId));
      await this.correctField.selectOption(c.field);
      await this.correctValue.fill(c.value);
      await this.correctReason.fill(c.reason);
      await this.correctEvidence.fill(c.evidence ?? '');
      const response = this.page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\//.test(r.url()), { timeout: 60_000 }).catch(() => null);
      await this.recordCorrectionButton.click();
      return response;
    });
  }
}
