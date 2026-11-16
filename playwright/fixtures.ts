import { test as base, expect, Browser, Page } from '@playwright/test';
import fs from 'fs';
import { authFile, AuthUserKey, TOKEN_KEY } from './auth.users';
import { trackUrl } from '../utils/url-logger';
import { ApplicantUser, BasePage, CerUser } from '../pages';

/**
 * Each user fixture opens its own isolated BrowserContext, signed in with that
 * user's saved token, so several users can act in one test.
 * Fixtures are lazy: only the users a test asks for are created.
 *
 *   adminPage / officerPage / applicantPage  -> raw Page
 *   admin / officer / applicant              -> page objects bound to that Page
 *
 * NOTE: the server remembers the active role per ACCOUNT, not per browser.
 * Two tests using the same account in different roles at the same time will
 * interfere - keep such tests serial.
 */
type UserFixtures = {
  adminPage: Page;
  officerPage: Page;
  applicantPage: Page;
  admin: CerUser;
  officer: CerUser;
  applicant: ApplicantUser;
};

async function openAs(browser: Browser, key: AuthUserKey, use: (p: Page) => Promise<void>) {
  const { token } = JSON.parse(fs.readFileSync(authFile(key), 'utf8'));
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // App session lives in sessionStorage; seed it before any page script runs
  await context.addInitScript(([k, t]) => {
    if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, t);
  }, [TOKEN_KEY, token] as const);
  const page = await context.newPage();
  await page.goto(process.env.BASE_URL!, { waitUntil: 'load' });
  await expect(page.getByRole('banner').getByRole('button', { name: /▾$/ }),
    `${key} is not signed in - rerun the setup project`).toBeVisible({ timeout: 20000 });
  // URL is hidden behind events - log it at start and on every change
  const stopTracking = trackUrl(page, key);
  await use(page);
  stopTracking();
  await context.close();
}

export const test = base.extend<UserFixtures>({
  adminPage:     async ({ browser }, use) => openAs(browser, 'admin', use),
  officerPage:   async ({ browser }, use) => openAs(browser, 'officer', use),
  applicantPage: async ({ browser }, use) => openAs(browser, 'applicant', use),

  admin:     async ({ adminPage }, use) => use(new CerUser(adminPage)),
  officer:   async ({ officerPage }, use) => use(new CerUser(officerPage)),
  applicant: async ({ applicantPage }, use) => use(new ApplicantUser(applicantPage)),
});

export { expect };

/** Convenience wrapper. */
export async function ensureRole(page: Page, role: string) {
  await new BasePage(page).ensureRole(role);
}
