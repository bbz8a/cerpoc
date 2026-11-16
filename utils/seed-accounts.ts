import { APIRequestContext, Page, expect, test } from '@playwright/test';
import { ApiClient, AuthApi } from '../api';
import { BasePage, LoginPage } from '../pages';

/**
 * Sandbox seed accounts (cer.admin, sunvolt.admin, sunvolt.user, gridcell.admin ...).
 * All share the password SANDBOX_SEED_PASSWORD from .env. Unlike the personal
 * accounts in accounts.ts they have a fixed role and no role switcher.
 */
export interface SeedAccount { username: string; password: string }

export function seedAccount(username: string): SeedAccount {
  const password = process.env.SANDBOX_SEED_PASSWORD;
  if (!password) throw new Error('SANDBOX_SEED_PASSWORD is not set in .env');
  return { username, password };
}

/** Signs out whoever is signed in and signs in the seed account (banner shows "Sign out" once in). */
export async function signInAsSeed(page: Page, account: SeedAccount) {
  await test.step(`Sign in as ${account.username}`, async () => {
    const base = new BasePage(page);
    if (await base.signOutButton.isVisible()) await base.signOut();
    const login = new LoginPage(page);
    if (!/\/login/.test(page.url())) await page.goto(process.env.BASE_URL!, { waitUntil: 'commit' });
    await login.expectLoaded();
    await login.username.fill(account.username);
    await login.password.fill(account.password);
    await login.signInButton.click();
    // The sandbox is slow: wait for the URL to leave /login, then the banner.
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60_000, waitUntil: 'commit' });
    await expect(base.signOutButton).toBeVisible({ timeout: 30_000 });
  });
}

/** Seeded sandbox records used across phases (ids are fixed by the seed data). */
export const SEED = {
  participants: {
    sunvolt: 'CER-P-01J0000000000000000SUNVOLT',
    gridcell: 'CER-P-01J000000000000000GRIDCELL',
  },
  models: {
    svBat10: 'CER-M-0000000000000000000SVBAT10',
    svBat20: 'CER-M-0000000000000000000SVBAT20', // SunVolt model GridCell has no units of
  },
  units: {
    /** Owned by SunVolt, installed by GridCell (CER-I-000000000000000000GCNMI001, NMI 4001234567). */
    svb10_000101: { serial: 'SVB10-24-000101', id: 'CER-D-000000000000000000SVBAT10A' },
  },
} as const;

/** API client signed in as a seed account (POST /auth/login); fails the test if login is refused. */
export async function seedApiClient(request: APIRequestContext, username: string): Promise<ApiClient> {
  const client = new ApiClient(request);
  const login = await new AuthApi(client).login({ username, password: seedAccount(username).password });
  expect(login.status, `login ${username}: ${JSON.stringify(login.problem)}`).toBe(200);
  return client;
}

/** Seed units of SV-BAT-10 used by the Phase 6 recall walkthrough (batch B2607-A in scope, B2607-B out). */
export const SV_BAT_10_UNITS = {
  u101: { serial: 'SVB10-24-000101', id: 'CER-D-000000000000000000SVBAT10A', batch: 'B2607-A' }, // installed by GridCell
  u102: { serial: 'SVB10-24-000102', id: 'CER-D-000000000000000000SVBAT10B', batch: 'B2607-A' }, // installed by GridCell
  u103: { serial: 'SVB10-24-000103', id: 'CER-D-000000000000000000SVBAT10C', batch: 'B2607-B' }, // GridCell-owned, uninstalled
} as const;

/** Participant with no part in SunVolt/GridCell records (the walkthrough's coastal.admin is not seeded on cerpoc). */
export const COASTAL_SIM = 'CER-P-01M51KS1P5WQW8JJA7CN6H9ZTW';
