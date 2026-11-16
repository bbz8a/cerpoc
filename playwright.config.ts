import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({

  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    video: 'on',
    // not ideal to have this in the config, but it is needed for the CERP login test to work for webkit, as the certificate is not trusted. This is a known issue with Playwright and self-signed certificates.
    ignoreHTTPSErrors: true,
    // Headed by default; set HEADLESS=1 (or run-e2e.ps1 -Headless) to run without a window. Videos are recorded either way.
    headless: !!process.env.HEADLESS,
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      // Logs in each user once and saves session to playwright/.auth/*.json
      name: 'setup',
      testDir: './playwright',
      testMatch: /.*\.setup\.ts/,
    },
    {
      // Business-as-usual positive flows (one page per scenario, users sign out/in)
      name: 'bau',
      testDir: './tests/bau',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // API tests against <BASE_URL>/api (no browser) - see api/ and api/spec/openapi.json
      name: 'api',
      testDir: './tests/api',
    },
    {
      // Restores accounts to a clean state after failed runs - NOT part of BAU
      name: 'recovery',
      testDir: './tests/recovery',
      use: { ...devices['Desktop Chrome'] },
    },
  /*  {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'], 
    },
     
*/
    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },

});
