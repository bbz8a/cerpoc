import { Page, test } from '@playwright/test';

/**
 * Application issues that should be REPORTED but must not stop the test.
 * Each appears as an 'issue' annotation in the HTML report and on the console.
 */
export function reportIssue(description: string) {
  console.warn(`[ISSUE] ${description}`);
  test.info().annotations.push({ type: 'issue', description });
}

/**
 * Reports browser console errors and uncaught page errors as issues.
 * Chrome's "Failed to load resource: ... status of 404 ()" does not name the resource, so the note adds the
 * requested URL (the message's source location) and the request method, e.g.
 *   console error on <page>: Failed to load resource: ... 404 () - GET https://…/api/applications/mine
 */
export function watchConsoleErrors(page: Page) {
  const failed = new Map<string, string>(); // url -> method of the last failed (>= 400) response
  page.on('response', r => { if (r.status() >= 400) failed.set(r.url(), r.request().method()); });
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    let text = msg.text().slice(0, 300);
    const resource = msg.location().url;
    if (/^Failed to load resource/.test(text) && resource) text += ` - ${failed.get(resource) ?? 'GET'} ${resource}`;
    reportIssue(`console error on ${page.url()}: ${text}`);
  });
  page.on('pageerror', err => reportIssue(`page error on ${page.url()}: ${err.message.slice(0, 300)}`));
}
