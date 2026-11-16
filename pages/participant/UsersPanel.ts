import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

export interface InviteUser {
  username: string;
  displayName: string;
  role: 'User' | 'Administrator';
  password: string;
  email?: string;
}

/**
 * "Users" - who can act for a participant. The same component appears in two places:
 *   participant_admin : /participant/users (whole page)
 *   cer_admin/officer : /cer/participants/<id> -> collapsed "Users — who can act for this participant" details
 * Table columns: User (display name + <code>username</code>) | Sign-in | Role | Status | Added | actions
 * Actions per row: "Make administrator" / "Make user" · "Disable" / enable. The caller's own row has none;
 * for the last active administrator they are rendered disabled.
 * Below: "Invite a user" -> Username, Display name, Role, Initial password, Email (optional) -> Invite.
 */
export class UsersPanel extends BasePage {
  readonly root: Locator;
  readonly table: Locator;
  readonly inviteButton: Locator;
  readonly forbidden: Locator;
  readonly adminOnlyNotice: Locator;

  private constructor(page: Page, root: Locator) {
    super(page);
    this.root = root;
    this.table = root.getByRole('table');
    this.inviteButton = root.getByRole('button', { name: 'Invite a user' });
    this.forbidden = root.getByRole('alert').filter({ hasText: 'Forbidden' });
    this.adminOnlyNotice = root.getByText(/^Only your participant administrator can view and manage users/);
  }

  /** Participant view: /participant/users. */
  static async openOwn(page: Page): Promise<UsersPanel> {
    return test.step('Open Users', async () => {
      await page.goto(`${process.env.BASE_URL}/participant/users`, { waitUntil: 'commit' });
      await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible({ timeout: 30_000 });
      return new UsersPanel(page, page.getByRole('main'));
    });
  }

  /** CER view: participant detail page, expands the Users details. */
  static async openForParticipant(page: Page, participantId: string): Promise<UsersPanel> {
    return test.step(`Open Users for ${participantId}`, async () => {
      await page.goto(`${process.env.BASE_URL}/cer/participants/${participantId}`, { waitUntil: 'commit' });
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
      const details = main.locator('details', { has: page.locator('summary', { hasText: /^Users/ }) });
      if (!(await details.evaluate(d => (d as HTMLDetailsElement).open))) await details.locator('summary').first().click();
      const panel = new UsersPanel(page, details);
      await expect(panel.table.or(panel.forbidden)).toBeVisible({ timeout: 30_000 });
      return panel;
    });
  }

  /** Row whose username cell shows exactly this username. */
  row(username: string): Locator {
    return this.table.locator('tbody tr').filter({ has: this.page.locator('code', { hasText: new RegExp(`^${username.replace(/[.+]/g, '\\$&')}$`) }) });
  }

  cell(username: string, column: 'Sign-in' | 'Role' | 'Status' | 'Added'): Locator {
    const index = { 'Sign-in': 1, Role: 2, Status: 3, Added: 4 }[column];
    return this.row(username).getByRole('cell').nth(index);
  }

  action(username: string, name: string | RegExp): Locator {
    return this.row(username).getByRole('button', { name });
  }

  async invite(user: InviteUser): Promise<Response> {
    return test.step(`Invite ${user.username} as ${user.role}`, async () => {
      await this.inviteButton.click();
      const form = this.root;
      await form.getByRole('textbox', { name: /^Username/ }).fill(user.username);
      await form.getByRole('textbox', { name: 'Display name', exact: true }).fill(user.displayName);
      await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption({ label: user.role });
      await form.getByRole('textbox', { name: /^Initial password/ }).fill(user.password);
      if (user.email) await form.getByRole('textbox', { name: /^Email address/ }).fill(user.email);
      return this.submitAndWait(form.getByRole('button', { name: 'Invite', exact: true }), 'POST');
    });
  }

  /** Clicks a row action (Make administrator / Make user / Disable / Enable) and returns the PATCH response. */
  async act(username: string, name: string | RegExp): Promise<Response> {
    return test.step(`${name} ${username}`, async () => this.submitAndWait(this.action(username, name), 'PATCH'));
  }

  private async submitAndWait(button: Locator, method: 'POST' | 'PATCH'): Promise<Response> {
    // Actions apply immediately (no confirmation step).
    const response = this.page.waitForResponse(r => r.request().method() === method && /\/api\/participants\/[^/]+\/users/.test(r.url()), { timeout: 60_000 });
    await button.click();
    return response;
  }
}
