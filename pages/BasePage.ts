import { Page, Locator, expect, test } from '@playwright/test';

/** What to do with an open application when switching to Applicant. */
export type OpenApplicationChoice = 'continue' | 'new';
/** Landing page the app redirects to after switching to each role. */
const ROLE_HOME: Record<string, { path: string; heading: string }> = {
  cer_admin: { path: '/cer', heading: 'Executive dashboard' },
  cer_officer: { path: '/cer', heading: 'Executive dashboard' },
  participant_admin: { path: '/participant', heading: 'Participant workbench' },
  participant_user: { path: '/participant', heading: 'Participant workbench' },
  applicant: { path: '/applicant', heading: 'Participant application' },
};

/** Fixed choice, or decide from the held application's legal name. */
export type OpenApplicationPolicy = OpenApplicationChoice | ((heldLegalName: string) => OpenApplicationChoice);

/** Shared topbar/sidebar behaviour available on every screen. */
export class BasePage {
  readonly sidebar: Locator;
  readonly nav: Locator;
  readonly userMenu: Locator;
  readonly roleDialog: Locator;
  readonly roleSelect: Locator;
  readonly switchButton: Locator;
  readonly signOutButton: Locator;

  constructor(readonly page: Page) {
    this.sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    this.nav = page.getByRole('navigation', { name: 'Workbench' });
    // Button text is "<User name> (<role>) ▾"
    this.userMenu = page.getByRole('banner').getByRole('button', { name: /▾$/ });
    this.roleDialog = page.getByRole('dialog', { name: 'Switch role and organisation' });
    this.roleSelect = this.roleDialog.getByRole('combobox', { name: /^Role/ });
    this.switchButton = this.roleDialog.getByRole('button', { name: 'Switch' });
    this.signOutButton = page.getByRole('button', { name: 'Sign out' });
  }

  async expectLoaded() {
    await expect(this.sidebar).toContainText('RegiGov');
  }

  async currentRole(): Promise<string | null> {
    const label = await this.userMenu.innerText();
    return label.match(/\(([^)]+)\)/)?.[1] ?? null;
  }

  /**
   * Ensure the account is acting in the given role. The server remembers the
   * last role used per account (and may change it, e.g. applicant becomes
   * participant_admin once approved), so always verify before acting.
   * Role values: cer_admin, cer_officer, participant_admin, participant_user, applicant
   *
   * Participant roles act FOR an organisation: pass its legal name and the
   * switch is always performed (the menu label doesn't show the organisation).
   */
  async ensureRole(role: string, organisation?: string, openApplication: OpenApplicationPolicy = 'continue', force = false) {
    await test.step(`Ensure role is ${role}${organisation ? ` for ${organisation}` : ''}${force ? ' (forced switch)' : ''}`, async () => {
      await expect(this.userMenu).toBeVisible();
      if (!force && !organisation && (await this.currentRole()) === role) return;
      await this.userMenu.click();
      await expect(this.roleDialog).toBeVisible();
      await this.roleSelect.selectOption(role);
      if (organisation) await this.chooseOrganisation(organisation);
      if (role === 'applicant') await this.chooseOpenApplication(openApplication);
      await expect(this.switchButton).toBeEnabled();
      // The switch completes asynchronously and then redirects to the role's home
      // page. Wait for the server to confirm and the page to settle, otherwise the
      // redirect can land after the test has already navigated elsewhere.
      // (The menu label may already show the role from a previous session.)
      const confirmed = this.page.waitForResponse(r =>
        r.url().includes('/api/testing/me/identity') && r.request().method() === 'POST');
      await this.switchButton.click();
      const response = await confirmed;
      if (!response.ok()) {
        const conflict = this.roleDialog.getByRole('alert');
        const detail = (await conflict.isVisible()) ? (await conflict.innerText()).replace(/\s+/g, ' ') : `HTTP ${response.status()}`;
        throw new Error(`Role switch to ${role} rejected by server: ${detail}`);
      }
      await expect(this.roleDialog).toBeHidden();
      await expect(this.userMenu).toContainText(`(${role})`);
      // Wait for the redirect to the role's home page instead of full network idle:
      // the app polls continuously, so 'networkidle' could take ~20s. A short capped
      // settle wait still lets any late re-render finish.
      const home = ROLE_HOME[role];
      if (home) {
        await this.page.waitForURL(u => u.pathname === home.path, { timeout: 15000 });
        await expect(this.page.getByRole('heading', { level: 1, name: home.heading })).toBeVisible({ timeout: 15000 });
      }
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { /* app polls - cap the wait */ });
    });
  }

  /**
   * Switching to Applicant while the account holds an open (draft) application
   * shows "You hold the open application for <name>" with two choices:
   *   Continue it (draft)  |  Begin a new application (withdraws <name>)
   * "Continue it" is pre-ticked, but unless an option is actively clicked the
   * server rejects the switch with a Conflict (409). Always click the choice.
   * The group renders a moment AFTER Applicant is selected - wait for it.
   */
  private async chooseOpenApplication(policy: OpenApplicationPolicy) {
    const group = this.roleDialog.getByRole('group', { name: /^You hold the open application for / });
    const shown = await group.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    if (!shown) return; // nothing held
    const label = (await group.getAttribute('aria-label')) ?? (await group.innerText());
    const held = label.replace(/\s+/g, ' ').match(/You hold the open application for (.+?)(?: Continue it|$)/)?.[1]?.trim() ?? '';
    const choice = typeof policy === 'function' ? policy(held) : policy;
    test.info().annotations.push({ type: 'open application', description: `${held} -> ${choice === 'continue' ? 'Continue it (draft)' : 'Begin a new application (withdraws it)'}` });
    const radio = choice === 'continue'
      ? group.getByRole('radio', { name: /^Continue it/ })
      : group.getByRole('radio', { name: /^Begin a new application/ });
    await radio.click();
    await expect(radio).toBeChecked();
  }

  /**
   * Organisation picker (participant roles only): a filter box plus a native
   * <select size=n> listing "<legal name> (<ABN>)". Switch stays disabled until
   * an option is selected - typing in the filter alone is not enough.
   */
  private async chooseOrganisation(legalName: string) {
    await this.roleDialog.getByRole('searchbox', { name: 'Organisation' }).fill(legalName);
    const list = this.roleDialog.getByRole('listbox', { name: 'Organisation' });
    const option = list.locator('option', { hasText: `${legalName} (` });
    await expect(option, `Organisation "${legalName}" not offered`).toHaveCount(1);
    await list.selectOption((await option.getAttribute('value'))!);
  }

  async signOut() {
    await test.step('Sign out', async () => {
      await this.signOutButton.click();
      await expect(this.signOutButton).not.toBeVisible();
    });
  }
}
