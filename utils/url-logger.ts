import { Page, test } from '@playwright/test';

/**
 * Records the page URL once at the start and again whenever it changes
 * (including SPA history changes). Entries appear as 'url' annotations in
 * the HTML report and on the console.
 * Returns a function that stops tracking.
 */
export function trackUrl(page: Page, label: string): () => void {
  let last = '';

  const record = (url: string) => {
    if (url === last) return;
    const note = `[${label}] ${last ? 'changed' : 'start'}: ${url}`;
    last = url;
    console.log(`[${new Date().toISOString()}] ${note}`);
    test.info().annotations.push({ type: 'url', description: note });
  };

  record(page.url());
  const onNav = (frame: import('@playwright/test').Frame) => {
    if (frame === page.mainFrame()) record(frame.url());
  };
  page.on('framenavigated', onNav);
  return () => page.off('framenavigated', onNav);
}
