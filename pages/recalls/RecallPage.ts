import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';
import { IncidentSeverity } from '../../api/models/phase4';

type Workbench = 'participant' | 'cer';
export type AffectedUnitStatus = 'notified' | 'acknowledged' | 'remediated' | 'verified' | 'closed';

export interface RecallForm {
  modelId: string;
  batches?: string[];
  incidentId?: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  remedy: string;
  withdrawModel?: boolean;
}

/**
 * Recalls list: /cer/recalls (all) or /participant/recalls (those the participant is party to).
 * Search + Status (All statuses / Open / Closed); "Recall list" sidebar of links
 * "<title> <severity> <status> <model> … <n> of <m> units closed". CER: "Raise a recall" -> /cer/recalls/new.
 */
export class RecallsPage extends BasePage {
  readonly main: Locator;
  readonly list: Locator;
  readonly count: Locator;

  constructor(page: Page, readonly workbench: Workbench) {
    super(page);
    this.main = page.getByRole('main');
    this.list = this.main.getByRole('complementary', { name: 'Recall list' });
    this.count = this.main.getByRole('search', { name: 'Search recalls' }).getByRole('status');
  }

  async open() {
    await test.step(`Open ${this.workbench} Recalls`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/${this.workbench}/recalls`, { waitUntil: 'commit' });
      await expect(this.count).toContainText(/\d+ recalls?/, { timeout: 30_000 });
    });
  }

  link(recallId: string): Locator {
    return this.list.locator(`a[href$="/recalls/${recallId}"]`);
  }

  /** Raise a recall form (/cer/recalls/new) -> POST /api/recalls; returns the response (body = recall). */
  async raise(r: RecallForm): Promise<Response> {
    return test.step(`Raise recall "${r.title}" on ${r.modelId}${r.batches ? ` batches ${r.batches.join(',')}` : ''}${r.withdrawModel ? ' + withdraw model' : ''}`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/cer/recalls/new`, { waitUntil: 'commit' });
      const form = this.main;
      await expect(form.getByRole('button', { name: 'Raise recall' })).toBeVisible({ timeout: 30_000 });
      await form.getByRole('textbox', { name: /^Model ID/ }).fill(r.modelId);
      await form.getByRole('textbox', { name: /^Batches/ }).fill((r.batches ?? []).join(', '));
      await form.getByRole('textbox', { name: /^Linked incident/ }).fill(r.incidentId ?? '');
      await form.getByRole('combobox', { name: 'Severity' }).selectOption(r.severity);
      await form.getByRole('textbox', { name: 'Title', exact: true }).fill(r.title);
      await form.getByRole('textbox', { name: /^Hazard description/ }).fill(r.description);
      await form.getByRole('textbox', { name: /^Remedy/ }).fill(r.remedy);
      await form.getByRole('checkbox', { name: /^Model status/ }).setChecked(!!r.withdrawModel);
      const response = this.page.waitForResponse(x => x.request().method() === 'POST' && /\/api\/recalls\/?$/.test(x.url()), { timeout: 60_000 });
      await form.getByRole('button', { name: 'Raise recall' }).click();
      return response;
    });
  }
}

/**
 * Recall detail (/cer/recalls/<CER-R-…> or /participant/recalls/<CER-R-…>), shown beside the recall list.
 * Heading (h2) = title, "<severity> <status>", dt/dd (Recall ID, Model + model status, Manufacturer, Scope,
 * Linked incident, Raised by, Raised, Closed), Hazard, Remedy, Progress (stage filter buttons
 * "Notified <n>" …), Responsibility and batches tables, Affected units, Recall timeline, Add a note and,
 * for CER, "Re-resolve units" and Close recall (Closing note + Close recall; disabled while units are open).
 *
 * Affected unit row: serial link, "batch <b> <status> NMI <nmi> · responsible: <participant>", Details/Hide.
 * Expanded: dt/dd (Unit ID, Status at recall, Installation, Address, Owner, Installer, Responsible, Added to
 * recall), Resolution trail (When | Event | By | Note | Evidence), Note + Evidence reference, Add note and
 *   responsible participant : "Mark acknowledged" / "Mark remediated"
 *   CER                     : "CER unit status" select (verified / closed) + "Set unit <status>"
 */
export class RecallPage extends BasePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly timeline: Locator;
  readonly reResolveButton: Locator;
  readonly closingNote: Locator;
  readonly closeRecallButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 2 }).first();
    this.timeline = this.main.getByRole('region', { name: 'Recall timeline' }).getByRole('table');
    this.reResolveButton = this.main.getByRole('button', { name: 'Re-resolve units' });
    this.closingNote = this.main.getByRole('textbox', { name: 'Closing note' });
    this.closeRecallButton = this.main.getByRole('button', { name: 'Close recall' });
  }

  async open(workbench: Workbench, recallId: string) {
    await test.step(`Open recall ${recallId}`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/${workbench}/recalls/${recallId}`, { waitUntil: 'commit' });
      await this.expectRecall(recallId);
    });
  }

  async expectRecall(recallId: string) {
    await expect(this.field('Recall ID')).toHaveText(recallId, { timeout: 30_000 });
    await expect(this.main.getByRole('heading', { name: 'Affected units' })).toBeVisible();
  }

  field(label: string): Locator {
    return this.main.locator(`dt:text-is("${label}") + dd`).first();
  }

  /** The unit's row: the smallest element holding its serial link and its Details/Hide button. */
  unit(serial: string): Locator {
    return this.main.locator('li, article, section, div')
      .filter({ has: this.page.getByRole('link', { name: serial, exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: /^(Details|Hide)$/ }) })
      .last();
  }

  /**
   * Expands a unit's Details and returns its block. The expanded details (dt/dd, Resolution trail, note and
   * status controls) are rendered beside the row, not inside it, so the block is the nearest ancestor of the
   * serial link that holds a "Resolution trail" - tagged with data-e2e-unit. Other units are collapsed first
   * so their controls cannot be picked up.
   */
  async expand(serial: string): Promise<Locator> {
    const row = this.unit(serial);
    const link = this.main.getByRole('link', { name: serial, exact: true });
    if (!(await row.getByRole('button', { name: 'Hide', exact: true }).isVisible())) {
      for (const hide of await this.main.getByRole('button', { name: 'Hide', exact: true }).all()) await hide.click();
      await row.getByRole('button', { name: 'Details', exact: true }).click();
    }
    await expect(row.getByRole('button', { name: 'Hide', exact: true })).toBeVisible({ timeout: 15_000 });
    const tag = serial.replace(/\W+/g, '_');
    await expect.poll(() => link.evaluate((a, t) => {
      for (let e = a.parentElement; e; e = e.parentElement) {
        if (Array.from(e.querySelectorAll('h1,h2,h3,h4,h5')).some(h => h.textContent?.trim() === 'Resolution trail')) {
          e.setAttribute('data-e2e-unit', t);
          return true;
        }
      }
      return false;
    }, tag), { message: `Resolution trail for ${serial}`, timeout: 15_000 }).toBe(true);
    return this.main.locator(`[data-e2e-unit="${tag}"]`);
  }

  unitField(block: Locator, label: string): Locator {
    return block.locator(`dt:text-is("${label}") + dd`);
  }

  async trail(block: Locator): Promise<{ event: string; by: string; note: string; evidence: string }[]> {
    const rows = await block.getByRole('table').locator('tbody tr').evaluateAll(trs =>
      trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').replace(/\s+/g, ' ').trim())));
    return rows.map(([, event, by, note, evidence]) => ({ event, by, note: note ?? '', evidence: evidence ?? '' }));
  }

  private waitFor(kind: 'status' | 'notes' | 'close', unitScoped = true): Promise<Response> {
    const re = unitScoped ? new RegExp(`/api/recalls/[^/]+/units/[^/]+/${kind}$`) : new RegExp(`/api/recalls/[^/]+/${kind}$`);
    return this.page.waitForResponse(r => r.request().method() === 'POST' && re.test(r.url()), { timeout: 60_000 });
  }

  private async fillNote(block: Locator, note: string, evidenceRef?: string) {
    await block.getByRole('textbox', { name: 'Note', exact: true }).fill(note);
    await block.getByRole('textbox', { name: /^Evidence reference/ }).fill(evidenceRef ?? '');
  }

  /** Unit note with an evidence reference (responsible participant or CER). */
  async addUnitNote(serial: string, note: string, evidenceRef?: string): Promise<Response> {
    return test.step(`Note on ${serial}`, async () => {
      const block = await this.expand(serial);
      await this.fillNote(block, note, evidenceRef);
      const response = this.waitFor('notes');
      await block.getByRole('button', { name: 'Add note' }).click();
      return response;
    });
  }

  /** Responsible participant: "Mark acknowledged" / "Mark remediated" (the note is required). */
  async markUnit(serial: string, status: 'acknowledged' | 'remediated', note: string, evidenceRef?: string): Promise<Response> {
    return test.step(`Mark ${serial} ${status}`, async () => {
      const block = await this.expand(serial);
      await this.fillNote(block, note, evidenceRef);
      const response = this.waitFor('status');
      await block.getByRole('button', { name: `Mark ${status}` }).click();
      return response;
    });
  }

  /** CER: "CER unit status" (verified / closed) + "Set unit <status>". */
  async setUnit(serial: string, status: 'verified' | 'closed', note: string): Promise<Response> {
    return test.step(`Set ${serial} ${status}`, async () => {
      const block = await this.expand(serial);
      await block.getByRole('combobox', { name: 'CER unit status' }).selectOption(status);
      await this.fillNote(block, note);
      const response = this.waitFor('status');
      await block.getByRole('button', { name: `Set unit ${status}` }).click();
      return response;
    });
  }

  /** CER: "Re-resolve units" -> POST /api/recalls/<id>/refresh. */
  async reResolve(): Promise<Response> {
    return test.step('Re-resolve units', async () => {
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/recalls\/[^/]+\/refresh$/.test(r.url()), { timeout: 60_000 });
      await this.reResolveButton.click();
      return response;
    });
  }

  /** CER: Closing note + Close recall -> POST /api/recalls/<id>/close. */
  async closeRecall(note: string): Promise<Response> {
    return test.step('Close recall', async () => {
      await this.closingNote.fill(note);
      const response = this.waitFor('close', false);
      await this.closeRecallButton.click();
      return response;
    });
  }
}
