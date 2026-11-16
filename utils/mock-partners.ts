import { APIRequestContext, expect, test } from '@playwright/test';

/**
 * mock-partners (AEMO, STC registry, network operator stand-ins; port 4100 in the app repo).
 * Every route except /health needs Authorization: Bearer $PARTNER_API_KEY.
 *
 *   MOCK_PARTNERS_URL  e.g. http://localhost:4100 - not exposed on https://cerpoc.regigov.au
 *   PARTNER_API_KEY    shared partner key (also the x-partner-key for /api/exchange/inbox/...)
 *
 * Steps that need it are skipped (with the reason) when either is missing.
 */
export const mockPartnersConfig = () => ({
  url: process.env.MOCK_PARTNERS_URL?.replace(/\/$/, ''),
  key: process.env.PARTNER_API_KEY,
});

export const MOCK_PARTNERS_MISSING = 'Fault injection needs MOCK_PARTNERS_URL and PARTNER_API_KEY in .env (mock-partners is not reachable from the public sandbox)';

export function mockPartnersAvailable(): boolean {
  const { url, key } = mockPartnersConfig();
  return !!url && !!key;
}

export type InboundFault = 'duplicate' | 'late' | 'malformed' | 'replay';

export interface SnapshotTweak {
  id: string;
  set?: Record<string, unknown>;
  add?: Record<string, unknown>;
}

export class MockPartners {
  constructor(private readonly request: APIRequestContext) {}

  private async call(method: 'GET' | 'POST', path: string, data?: unknown): Promise<{ status: number; json: any; text: string }> {
    const { url, key } = mockPartnersConfig();
    if (!url || !key) throw new Error(MOCK_PARTNERS_MISSING);
    const r = await this.request.fetch(`${url}${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, data,
    });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    test.info().annotations.push({ type: 'mock-partners', description: `${method} ${path} -> ${r.status()} ${text.slice(0, 200)}` });
    return { status: r.status(), json, text };
  }

  private async ok(method: 'GET' | 'POST', path: string, data?: unknown) {
    const r = await this.call(method, path, data);
    expect(r.status, `mock-partners ${method} ${path}: ${r.text.slice(0, 300)}`).toBeLessThan(300);
    return r;
  }

  async health(): Promise<boolean> {
    const { url } = mockPartnersConfig();
    if (!url) return false;
    return this.request.get(`${url}/health`).then(r => r.ok(), () => false);
  }

  /** POST /faults/aemo {"failNext": n} - AEMO refuses the next n deliveries. */
  failNextAemo(n: number) {
    return this.ok('POST', '/faults/aemo', { failNext: n });
  }

  /** POST /faults/aemo {"snapshotTweaks": [...]} - alters what AEMO's snapshot returns to reconciliation. */
  tweakAemoSnapshot(snapshotTweaks: SnapshotTweak[]) {
    return this.ok('POST', '/faults/aemo', { snapshotTweaks });
  }

  /** POST /aemo/emit - sends an inbound event to RegiGov with the chosen fault (or none). */
  emitAemo(eventType: string, payload: Record<string, unknown>, fault?: InboundFault) {
    return this.ok('POST', '/aemo/emit', { eventType, payload, ...(fault ? { fault } : {}) });
  }

  /** POST /stc/v1/files/generate - drops a claims CSV for the worker to pull (optionally with a malformed row). */
  generateStcFile(claims: { deviceId: string; serial: string }[], includeMalformedRow = false) {
    return this.ok('POST', '/stc/v1/files/generate', { claims, includeMalformedRow });
  }
}
