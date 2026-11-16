import { Page, Locator, expect, test } from '@playwright/test';
import { Account } from '../utils/accounts';

/** Login screen (/login). */
export class LoginPage {
  readonly username: Locator;
  readonly password: Locator;
  readonly signInButton: Locator;
  readonly userMenu: Locator;

  constructor(readonly page: Page) {
    this.username = page.getByRole('textbox', { name: 'Username' });
    this.password = page.getByRole('textbox', { name: 'Password' });
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
    this.userMenu = page.getByRole('banner').getByRole('button', { name: /▾$/ });
  }

  async expectLoaded() {
    await expect(this.username).toBeVisible();
  }

  /** Signs in from the login page. Session token is held in sessionStorage. */
  async login(account: Account) {
    await test.step(`Sign in as ${account.key}`, async () => {
      if (!/\/login/.test(this.page.url())) {
        await this.page.goto(process.env.BASE_URL!, { waitUntil: 'load' });
      }
      await this.expectLoaded();
      await this.username.fill(account.username);
      await this.password.fill(account.password);
      await this.signInButton.click();
      await expect(this.userMenu).toBeVisible({ timeout: 20000 });
    });
  }
}
