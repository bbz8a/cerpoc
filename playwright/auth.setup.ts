import { test as setup, expect, Page } from '@playwright/test';
import fs from 'fs';
import { AUTH_DIR, AUTH_USERS, TOKEN_KEY, authFile } from './auth.users';

/**
 * Logs in once per user and saves the bearer token to playwright/.auth/<key>.json.
 * The app keeps its session in sessionStorage, which Playwright's storageState
 * does not capture, so the token is saved explicitly and re-injected by
 * playwright/fixtures.ts. Runs as the 'setup' project before tests.
 */
async function login(page: Page, username: string, password: string) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) throw new Error('BASE_URL is not set in .env');

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.getByLabel(/email|username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();

  // Confirm login succeeded before saving: user menu "<name> (<role>) ▾" is shown
  await expect(page.getByRole('banner').getByRole('button', { name: /▾$/ })).toBeVisible({ timeout: 20000 });
}

for (const u of AUTH_USERS) {
  setup(`authenticate ${u.key}`, async ({ page }) => {
    const username = process.env[u.userEnv];
    const password = process.env[u.passEnv];
    if (!username || !password) {
      throw new Error(`Missing ${u.userEnv} / ${u.passEnv} in .env`);
    }
    await login(page, username, password);
    const token = await page.evaluate(k => sessionStorage.getItem(k), TOKEN_KEY);
    if (!token) throw new Error(`No ${TOKEN_KEY} in sessionStorage after login for ${u.key}`);
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(authFile(u.key), JSON.stringify({ token }));
  });
}
