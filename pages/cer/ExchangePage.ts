import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export type ExchangeSection = 'Interface catalogue' | 'Outbox' | 'Inbox' | 'Dead letters' | 'Reconciliation';
export type PartnerLabel = 'AEMO' | 'STC registry' | 'Network operator';
export type ReviewStatus = 'accepted' | 'actioned' | 'dismissed';

const SECTION_TAB: Record<ExchangeSection, string> = {
  'Interface catalogue': '', Outbox: 'outbox', Inbox: 'inbox', 'Dead letters': 'dead-letters', Reconciliation: 'reconciliation',
};

/** Reads a table into rows of { header: cell text } (whitespace collapsed). */
async function tableRows(table: Locator): Promise<Record<string, string>[]> {
  return table.evaluate(t => {
    const heads = Array.from(t.querySelectorAll('thead th')).map(th => (th.textContent ?? '').trim());
    return Array.from(t.querySelectorAll('tbody tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td =>
        // DOM text (not innerText: badges are upper-cased by CSS), with a space between child nodes
        // so "<strong>id</strong>description" does not run together.
        Array.from(td.childNodes).map(n => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim());
      return Object.fromEntries(heads.map((h, i) => [h || `#${i}`, cells[i] ?? '']));
    });
  });
}

/**
 * Information exchange (/cer/exchange) - cer_officer / cer_admin, nav "Exchange".
 * Summary counts (Outbox / Inbox / Dead letters / Last reconciliation) above an "Exchange sections" button bar:
 *   Interface catalogue : Interface | Partner | Direction | Transport | Version | Status | Events | Behaviour (details)
 *   Outbox              : search Register id / Partner / Status; "Publish unpublished records";
 *                         # (link to /cer/exchange/outbox/<id>) | Partner / interface | Event | Entity | Status | Attempts | Queued | Delivered / next attempt
 *   Inbox               : search Register id / Partner / Disposition (applied, late, duplicate, replayed, malformed, failed)
 *   Dead letters        : filter Partner / Status (open, replayed, discarded)
 *   Reconciliation      : "Reconcile <partner> now" buttons; Run (link) | Partner | Status | Started | Triggered by | Register | Partner | Matched | Differences
 * Each section is also reachable as /cer/exchange?tab=<outbox|inbox|dead-letters|reconciliation>.
 */
export class ExchangePage extends BasePage {
  readonly main: Locator;
  readonly sections: Locator;
  readonly table: Locator;
  readonly count: Locator;
  readonly publishUnpublished: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.sections = this.main.getByRole('navigation', { name: 'Exchange sections' });
    this.table = this.main.getByRole('table');
    this.count = this.main.getByRole('search').getByRole('status');
    this.publishUnpublished = this.main.getByRole('button', { name: 'Publish unpublished records' });
  }

  async open(section: ExchangeSection = 'Interface catalogue') {
    await test.step(`Open Information exchange - ${section}`, async () => {
      const tab = SECTION_TAB[section];
      await this.page.goto(`${process.env.BASE_URL}/cer/exchange${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1, name: 'Information exchange' })).toBeVisible({ timeout: 30_000 });
      await expect(this.sections).toBeVisible();
      if (section !== 'Interface catalogue') await expect(this.count).toBeVisible({ timeout: 30_000 });
    });
  }

  async show(section: ExchangeSection) {
    await test.step(`Show ${section}`, async () => {
      await this.sections.getByRole('button', { name: section, exact: true }).click();
      if (section !== 'Interface catalogue') await expect(this.count).toBeVisible({ timeout: 30_000 });
    });
  }

  rows(): Promise<Record<string, string>[]> {
    return tableRows(this.table);
  }

  // ---------------------------------------------------------------- catalogue

  /** Catalogue row for an interface id and version (several interfaces exist in v1 and v2). */
  catalogueRow(interfaceId: string, version: string): Locator {
    return this.table.locator('tbody tr')
      .filter({ has: this.page.locator('strong', { hasText: new RegExp(`^${interfaceId.replace(/\./g, '\\.')}$`) }) })
      .filter({ has: this.page.getByRole('cell', { name: version, exact: true }) });
  }

  /** Expands the row's "Auth, idempotency, retry, DLQ, reconciliation" group; returns term -> definition. */
  async behaviour(interfaceId: string, version: string): Promise<Record<string, string>> {
    const details = this.catalogueRow(interfaceId, version).locator('details');
    if (!(await details.evaluate(d => (d as HTMLDetailsElement).open))) await details.locator('summary').click();
    return details.evaluate(d => Object.fromEntries(Array.from(d.querySelectorAll('dt')).map(dt =>
      [(dt.textContent ?? '').trim(), ((dt.nextElementSibling?.textContent) ?? '').replace(/\s+/g, ' ').trim()])));
  }

  /** Shows all catalogue rows on one page (default page size is 10). */
  async showAllRows() {
    const perPage = this.main.getByRole('combobox', { name: 'Records per page' });
    if (await perPage.isVisible()) await perPage.selectOption('20');
  }

  // ---------------------------------------------------------------- outbox / inbox search

  /** Outbox or Inbox search; returns the GET /api/exchange/<outbox|inbox> response. */
  async search(filter: { registerId?: string; partner?: PartnerLabel; status?: string; disposition?: string }): Promise<Response> {
    return test.step(`Search ${JSON.stringify(filter)}`, async () => {
      const form = this.main.getByRole('search');
      await form.getByRole('textbox', { name: 'Register id' }).fill(filter.registerId ?? '');
      await form.getByRole('combobox', { name: 'Partner' }).selectOption(filter.partner ?? { label: 'All partners' });
      const status = form.getByRole('combobox', { name: 'Status' });
      if (await status.isVisible()) await status.selectOption(filter.status ?? { label: 'All statuses' });
      const disposition = form.getByRole('combobox', { name: 'Disposition' });
      if (await disposition.isVisible()) await disposition.selectOption(filter.disposition ?? { label: 'All dispositions' });
      const response = this.page.waitForResponse(r => r.request().method() === 'GET' && /\/api\/exchange\/(outbox|inbox)\/?\?/.test(r.url()), { timeout: 60_000 });
      await form.getByRole('button', { name: 'Search' }).click();
      return response;
    });
  }

  /** "Publish unpublished records" -> POST /api/exchange/outbox/publish-unpublished. */
  async publishUnpublishedRecords(): Promise<Response> {
    return test.step('Publish unpublished records', async () => {
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/exchange/outbox/publish-unpublished'), { timeout: 120_000 });
      await this.publishUnpublished.click();
      return response;
    });
  }

  // ---------------------------------------------------------------- dead letters

  /** Dead letters filter (Partner / Status) - applies on change. */
  async filterDeadLetters(status: 'open' | 'replayed' | 'discarded', partner?: PartnerLabel) {
    await test.step(`Dead letters: ${status}${partner ? ` (${partner})` : ''}`, async () => {
      const form = this.main.getByRole('search', { name: 'Filter dead letters' });
      await form.getByRole('combobox', { name: 'Partner' }).selectOption(partner ?? { label: 'All partners' });
      await form.getByRole('combobox', { name: 'Status' }).selectOption(status);
      await expect(this.count).toBeVisible();
    });
  }

  // ---------------------------------------------------------------- reconciliation

  /** "Reconcile <partner> now" -> POST /api/exchange/reconciliation; returns the response (body = run). */
  async reconcileNow(partner: PartnerLabel): Promise<Response> {
    return test.step(`Reconcile ${partner} now`, async () => {
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/exchange\/reconciliation\/?$/.test(r.url()), { timeout: 120_000 });
      await this.main.getByRole('button', { name: `Reconcile ${partner} now` }).click();
      return response;
    });
  }
}

/** Outbox message (/cer/exchange/outbox/<id>): dt/dd fields, Delivery attempts table, Payload as sent. */
export class OutboxMessagePage extends BasePage {
  readonly main: Locator;
  readonly attempts: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.attempts = this.main.getByRole('table');
  }

  async open(id: number) {
    await test.step(`Open outbox message ${id}`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/cer/exchange/outbox/${id}`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1, name: `Outbox message ${id}` })).toBeVisible({ timeout: 30_000 });
    });
  }

  field(label: string): Locator {
    return this.main.locator(`dt:text-is("${label}") + dd`);
  }

  attemptRows(): Promise<Record<string, string>[]> {
    return tableRows(this.attempts);
  }
}

/**
 * Dead letter detail. NOTE: no dead letters existed on the sandbox when this was written, so the
 * locators follow the API contract (POST .../replay {payload?, note?}, POST .../discard {note ≥ 3})
 * and the app's usual form conventions - confirm them on the first run with partner access.
 */
export class DeadLetterPage extends BasePage {
  readonly main: Locator;
  readonly payload: Locator;
  readonly note: Locator;
  readonly replayButton: Locator;
  readonly discardButton: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.payload = this.main.getByRole('textbox', { name: /payload/i });
    this.note = this.main.getByRole('textbox', { name: /note/i });
    this.replayButton = this.main.getByRole('button', { name: /^Replay/ });
    this.discardButton = this.main.getByRole('button', { name: /^Discard/ });
  }

  async open(id: number) {
    await test.step(`Open dead letter ${id}`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/cer/exchange/dead-letters/${id}`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1 })).toContainText(String(id), { timeout: 30_000 });
    });
  }

  field(label: string): Locator {
    return this.main.locator(`dt:text-is("${label}") + dd`);
  }

  private async resolve(button: Locator, action: 'replay' | 'discard', note: string, payload?: object): Promise<Response> {
    if (payload) await this.payload.fill(JSON.stringify(payload, null, 2));
    await this.note.fill(note);
    const response = this.page.waitForResponse(r => r.request().method() === 'POST' && new RegExp(`/api/exchange/dead-letters/\\d+/${action}$`).test(r.url()), { timeout: 60_000 });
    await button.click();
    return response;
  }

  replay(note: string, fixedPayload?: object): Promise<Response> {
    return test.step('Replay dead letter', () => this.resolve(this.replayButton, 'replay', note, fixedPayload));
  }

  discard(note: string): Promise<Response> {
    return test.step('Discard dead letter', () => this.resolve(this.discardButton, 'discard', note));
  }
}

/**
 * Reconciliation run (/cer/exchange/reconciliation/<id>): "Reconciliation run <id> — <partner>", status,
 * dt/dd counts, Differences filtered by Review (Unreviewed only / All). Each difference shows its
 * disposition (missing there / missing here / mismatch), entity kind and id, "Register value vs partner value",
 * "Review note (optional)" and Accept / Actioned / Dismiss.
 */
export class ReconciliationRunPage extends BasePage {
  readonly main: Locator;
  readonly reviewFilter: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.reviewFilter = this.main.getByRole('combobox', { name: 'Review' });
  }

  async open(runId: number) {
    await test.step(`Open reconciliation run ${runId}`, async () => {
      await this.page.goto(`${process.env.BASE_URL}/cer/exchange/reconciliation/${runId}`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1, name: new RegExp(`^Reconciliation run ${runId} — `) })).toBeVisible({ timeout: 30_000 });
    });
  }

  field(label: string): Locator {
    return this.main.locator(`dt:text-is("${label}") + dd`);
  }

  /** The block for one difference: the smallest element holding the entity link and an Accept button. */
  difference(entityId: string): Locator {
    return this.main.locator('li, article, section, div')
      .filter({ has: this.page.locator('code', { hasText: entityId }) })
      .filter({ has: this.page.getByRole('button', { name: 'Accept' }) })
      .last();
  }

  /** Accept / Actioned / Dismiss with a note -> POST /api/exchange/reconciliation/differences/<id>/review. */
  async review(entityId: string, status: ReviewStatus, note: string): Promise<Response> {
    return test.step(`Review ${entityId}: ${status}`, async () => {
      const block = this.difference(entityId);
      await block.getByRole('textbox', { name: 'Review note (optional)' }).fill(note);
      const button = { accepted: 'Accept', actioned: 'Actioned', dismissed: 'Dismiss' }[status];
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/exchange\/reconciliation\/differences\/\d+\/review$/.test(r.url()), { timeout: 60_000 });
      await block.getByRole('button', { name: button, exact: true }).click();
      return response;
    });
  }
}
