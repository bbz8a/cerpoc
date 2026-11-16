import { Page } from '@playwright/test';
import { TOKEN_KEY } from '../playwright/auth.users';

export interface PageApiResult { status: number; text: string; json: any }

/**
 * Calls the API from inside the page with the signed-in user's bearer token (sessionStorage),
 * e.g. for setup data or for checks the UI cannot express (a direct cross-tenant request).
 */
export async function pageApi(page: Page, method: string, path: string, body?: object): Promise<PageApiResult> {
  const { status, text } = await page.evaluate(async ({ method, path, body, key }) => {
    const r = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem(key)}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, text: await r.text() };
  }, { method, path, body, key: TOKEN_KEY });
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status, text, json };
}
