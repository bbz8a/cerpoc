import { Page, test } from '@playwright/test';

/**
 * Application issues that should be REPORTED but must not stop the test.
 * Each appears as an 'issue' annotation in the HTML report and on the console.
 */
export function reportIssue(description: string) {
  console.warn(`[ISSUE] ${description}`);
  test.info().annotations.push({ type: 'issue', description });
}

/** Reports browser console errors and uncaught page errors as issues. */
export function watchConsoleErrors(page: Page) {
  page.on('console', msg => {
    if (msg.type() === 'error') reportIssue(`console error on ${page.url()}: ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', err => reportIssue(`page error on ${page.url()}: ${err.message.slice(0, 300)}`));
}
