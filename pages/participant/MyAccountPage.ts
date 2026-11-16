import { Page, Locator, Response, expect, test } from '@playwright/test';
import { BasePage } from '../BasePage';

/**
 * My account (/participant/account): "Signed in as <name> (<username>), roles: ...".
 * Change password: Current password, New password (≥ 12), Confirm new password -> POST /api/auth/password
 * (204; a wrong current password is 403 "Current password is incorrect" and audited as access.denied).
 */
export class MyAccountPage extends BasePage {
  readonly main: Locator;
  readonly signedInAs: Locator;
  readonly currentPassword: Locator;
  readonly newPassword: Locator;
  readonly confirmPassword: Locator;
  readonly changeButton: Locator;
  readonly changed: Locator;
  readonly breadcrumb: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main');
    this.breadcrumb = this.main.getByRole('navigation', { name: 'Breadcrumb' });
    this.changed = this.main.getByText('Password changed.', { exact: true });
    this.signedInAs = this.main.getByText(/^Signed in as/);
    this.currentPassword = this.main.getByRole('textbox', { name: 'Current password', exact: true });
    this.newPassword = this.main.getByRole('textbox', { name: /^New password/ });
    this.confirmPassword = this.main.getByRole('textbox', { name: 'Confirm new password', exact: true });
    this.changeButton = this.main.getByRole('button', { name: 'Change password' });
  }

  async open() {
    await test.step('Open My account', async () => {
      await this.page.goto(`${process.env.BASE_URL}/participant/account`, { waitUntil: 'commit' });
      await expect(this.main.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible({ timeout: 30_000 });
    });
  }

  /** Submits the form; returns the POST /api/auth/password response. */
  async changePassword(current: string, next: string): Promise<Response> {
    return test.step('Change password', async () => {
      await this.currentPassword.fill(current);
      await this.newPassword.fill(next);
      await this.confirmPassword.fill(next);
      const response = this.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/auth/password'), { timeout: 60_000 });
      await this.changeButton.click();
      return response;
    });
  }
}
