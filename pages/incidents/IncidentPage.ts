import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';
import { IncidentStatus } from '../../api/models/phase4';

export interface TimelineRow { when: string; event: string; by: string; note: string }

/**
 * Incident detail (/participant/incidents/<CER-N-…> or /cer/incidents/<CER-N-…>).
 * Heading = title, then "<severity> <status>", dt/dd fields (Incident ID, Model, Manufacturer, Unit,
 * Installation, Reported by, Date observed, Evidence, Recall, Raised, Last updated), Description,
 * Timeline table (When | Event | By | Note), "Add a note" (Note + Add note) and, for CER only,
 * "Change status" (New status + Reason + Update status).
 */
export class IncidentPage extends BasePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly timeline: Locator;
  readonly note: Locator;
  readonly addNoteButton: Locator;
  readonly changeStatusHeading: Locator;
  readonly newStatus: Locator;
  readonly reason: Locator;
  readonly updateStatusButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1 });
    this.timeline = this.main.getByRole('table');
    this.note = this.main.getByRole('textbox', { name: 'Note', exact: true });
    this.addNoteButton = this.main.getByRole('button', { name: 'Add note' });
    this.changeStatusHeading = this.main.getByRole('heading', { level: 2, name: 'Change status' });
    this.newStatus = this.main.getByRole('combobox', { name: 'New status' });
    this.reason = this.main.getByRole('textbox', { name: /^Reason/ });
    this.updateStatusButton = this.main.getByRole('button', { name: 'Update status' });
  }

  async open(workbench: 'participant' | 'cer', incidentId: string) {
    await test.step(`Open incident ${incidentId}`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/${workbench}/incidents/${incidentId}`, { waitUntil: 'commit' });
      await this.expectIncident(incidentId);
    });
  }

  async expectIncident(incidentId: string) {
    await expect(this.field('Incident ID')).toHaveText(incidentId, { timeout: 30_000 });
  }

  field(label: string): Locator {
    return this.main.locator(`dt:text-is("${label}") + dd`);
  }

  /** "<severity> <status>" badges under the heading. */
  async expectStatus(status: IncidentStatus) {
    await expect(this.main.getByText(new RegExp(`^${status}$`)).first()).toBeVisible({ timeout: 30_000 });
  }

  async timelineRows(): Promise<TimelineRow[]> {
    const cells = await this.timeline.locator('tbody tr').evaluateAll(trs =>
      trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').replace(/\s+/g, ' ').trim())));
    return cells.map(([when, event, by, note]) => ({ when, event, by, note: note ?? '' }));
  }

  async addNote(text: string): Promise<Response> {
    return test.step('Add a note', async () => {
      await this.note.fill(text);
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/incidents\/[^/]+\/notes$/.test(r.url()), { timeout: 60_000 });
      await this.addNoteButton.click();
      return response;
    });
  }

  /** CER only. */
  async changeStatus(status: Exclude<IncidentStatus, 'open'>, reason: string): Promise<Response> {
    return test.step(`Change status to ${status}`, async () => {
      await this.newStatus.selectOption(status);
      await this.reason.fill(reason);
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/incidents\/[^/]+\/status$/.test(r.url()), { timeout: 60_000 });
      await this.updateStatusButton.click();
      return response;
    });
  }
}
