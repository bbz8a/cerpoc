import { Page } from '@playwright/test';
import { BasePage, LoginPage } from '../pages';
import { Account } from './accounts';
import { trackUrl } from './url-logger';
import { watchConsoleErrors } from './issues';

/**
 * Single-page session helpers: several users take turns in ONE page by
 * signing out and in, so the whole scenario is captured in a single video.
 */

/**
 * Opens the app, starts URL logging (URL is hidden behind events) and reports
 * browser console errors as issues without failing the test.
 */
export async function startSession(page: Page) {
  watchConsoleErrors(page);
  await page.goto(process.env.BASE_URL!, { waitUntil: 'load' });
  trackUrl(page, 'session');
}

/** Signs out whoever is signed in (if anyone) and signs in the given account. */
export async function signInAs(page: Page, account: Account) {
  const base = new BasePage(page);
  if (await base.signOutButton.isVisible()) await base.signOut();
  await new LoginPage(page).login(account);
}

export async function signOut(page: Page) {
  const base = new BasePage(page);
  if (await base.signOutButton.isVisible()) await base.signOut();
}
