import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';
import { IncidentSeverity, IncidentStatus } from '../../api/models/phase4';

type Workbench = 'participant' | 'cer';

/**
 * Incidents list: /participant/incidents (own reports only) or /cer/incidents (all reporters).
 * Search box "Search by title, id, serial or model number" + Status filter + Search (GET /api/incidents?status=&q=).
 * Columns: Incident (title link + <code>CER-N-…</code>) | Severity | Status | Model | Unit / site | [Reported by - CER only] | Raised
 */
export class IncidentsPage extends BasePage {
  readonly main: Locator;
  readonly searchForm: Locator;
  readonly search: Locator;
  readonly status: Locator;
  readonly searchButton: Locator;
  readonly count: Locator;
  readonly rows: Locator;
  readonly reportLink: Locator;

  constructor(page: Page, readonly workbench: Workbench) {
    super(page);
    this.main = page.getByRole('main');
    this.searchForm = this.main.getByRole('search', { name: 'Search incidents' });
    this.search = this.searchForm.getByRole('textbox', { name: 'Search' });
    this.status = this.searchForm.getByRole('combobox', { name: 'Status' });
    this.searchButton = this.searchForm.getByRole('button', { name: 'Search' });
    this.count = this.searchForm.getByRole('status');
    this.rows = this.main.getByRole('table').locator('tbody tr');
    this.reportLink = this.main.getByRole('link', { name: 'Report an incident' });
  }

  async open() {
    await test.step(`Open ${this.workbench} Incidents`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/${this.workbench}/incidents`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible({ timeout: 30_000 });
      await expect(this.count).toContainText(/\d+ incidents?/, { timeout: 30_000 });
    });
  }

  /** Runs a search; returns the GET /api/incidents response. */
  async searchFor(q: string, status?: IncidentStatus): Promise<Response> {
    return test.step(`Search incidents "${q}"${status ? ` (${status})` : ''}`, async () => {
      await this.search.fill(q);
      await this.status.selectOption(status ?? { label: 'All statuses' });
      const response = this.page.waitForResponse(r => r.request().method() === 'GET' && /\/api\/incidents\/?\?/.test(r.url()), { timeout: 60_000 });
      await this.searchButton.click();
      return response;
    });
  }

  row(incidentId: string): Locator {
    return this.rows.filter({ has: this.page.locator('code', { hasText: incidentId }) });
  }

  /** Cell text by header name (Severity, Status, Model, Unit / site, Reported by, Raised). */
  async cell(incidentId: string, header: string): Promise<Locator> {
    const headers = (await this.main.getByRole('table').locator('thead th').allInnerTexts()).map(h => h.trim());
    const index = headers.indexOf(header);
    expect(index, `column "${header}" in ${headers.join(' | ')}`).toBeGreaterThanOrEqual(0);
    return this.row(incidentId).getByRole('cell').nth(index);
  }
}

export interface IncidentReport {
  unitId?: string;
  installationId?: string;
  modelId?: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  occurredOn?: string; // YYYY-MM-DD
  evidenceRef?: string;
}

/** Report an incident (/participant/incidents/new) -> POST /api/incidents; on success opens the incident. */
export class ReportIncidentPage extends BasePage {
  readonly main: Locator;
  readonly unitId: Locator;
  readonly installationId: Locator;
  readonly modelId: Locator;
  readonly severity: Locator;
  readonly title: Locator;
  readonly description: Locator;
  readonly occurredOn: Locator;
  readonly evidenceRef: Locator;
  readonly submitButton: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    const device = this.main.getByRole('group', { name: 'Device to report' });
    this.unitId = device.getByRole('textbox', { name: 'Unit ID', exact: true });
    this.installationId = device.getByRole('textbox', { name: /^Installation ID/ });
    this.modelId = device.getByRole('textbox', { name: /^Model ID/ });
    this.severity = this.main.getByRole('combobox', { name: 'Severity' });
    this.title = this.main.getByRole('textbox', { name: 'Title', exact: true });
    this.description = this.main.getByRole('textbox', { name: /^Description/ });
    this.occurredOn = this.main.getByLabel(/^Date observed/);
    this.evidenceRef = this.main.getByRole('textbox', { name: /^Evidence reference/ });
    this.submitButton = this.main.getByRole('button', { name: 'Submit incident' });
    this.error = this.main.getByRole('alert');
  }

  async open() {
    await test.step('Open Report an incident', async () => {
      await this.page.goto(`${process.env.BASE_URL}/participant/incidents/new`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1, name: 'Report an incident' })).toBeVisible({ timeout: 30_000 });
    });
  }

  /** Fills and submits the form; returns the POST /api/incidents response. */
  async report(r: IncidentReport): Promise<Response> {
    return test.step(`Report "${r.title}" against ${r.unitId ?? r.installationId ?? r.modelId}`, async () => {
      await this.unitId.fill(r.unitId ?? '');
      await this.installationId.fill(r.installationId ?? '');
      await this.modelId.fill(r.modelId ?? '');
      await this.severity.selectOption(r.severity);
      await this.title.fill(r.title);
      await this.description.fill(r.description);
      if (r.occurredOn) await this.occurredOn.fill(r.occurredOn);
      if (r.evidenceRef) await this.evidenceRef.fill(r.evidenceRef);
      const response = this.page.waitForResponse(x => x.request().method() === 'POST' && /\/api\/incidents\/?$/.test(x.url()), { timeout: 60_000 });
      await this.submitButton.click();
      return response;
    });
  }
}
