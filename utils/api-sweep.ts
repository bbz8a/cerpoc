import fs from 'fs';
import path from 'path';
import { APIRequestContext, expect, test } from '@playwright/test';
import { ApiClient, ApiResult, apiBaseUrl } from '../api/ApiClient';
import { reportIssue } from './issues';

/**
 * API sweep: runs each significant API call of a phase once and classifies it against the documentation.
 *
 *   SUCCESS             documented on /cer/api-information, signature matches, call answered as expected
 *   FAILURE             documented and signature matches, but the call did not answer as expected
 *   DOES NOT EXIST      the call is not on /cer/api-information, or the route answers 404 (no such route)
 *   PARAMETER MISMATCH  the call exists but its parameters differ from the documentation and/or the
 *                       phase list (names, where they go, required), or the server rejects them
 *   NOT RUN             skipped by API_SKIP (e.g. API_SKIP=exchange,mail) - flaky areas
 *   NOT TESTABLE        needs data or a credential the API cannot provide (e.g. PARTNER_API_KEY)
 *   SHARED              listed again in a later phase - already run, see the earlier phase
 *
 * Documentation sources:
 *   data/api/api-information.json   scrape of /cer/api-information incl. each View's "What you send"
 *                                   table (refresh: node explore/41-api-catalogue.js)
 *   GET /api/docs/json              live OpenAPI - used only to tell an undocumented-but-served route apart
 *                                   and for query/path names (its request bodies are empty schemas)
 *
 * Results: data/cache/<host>.api-results.json + .md (latest run), one 'api' annotation per call, and an
 * 'issue' annotation (reportIssue) for FAILURE / PARAMETER MISMATCH. Test data created for the sweep is kept
 * in data/cache/<host>.api-fixtures.json so later runs can reuse it.
 */

export type Outcome = 'SUCCESS' | 'FAILURE' | 'DOES NOT EXIST' | 'PARAMETER MISMATCH' | 'NOT RUN' | 'NOT TESTABLE' | 'SHARED';
export type Group = 'exchange' | 'mail';
type Where = 'path' | 'query' | 'body';

export interface CallResult {
  phase: number;
  call: string;              // "GET /api/participants/{id}"
  outcome: Outcome;
  status?: number;
  documented: boolean;       // on /cer/api-information
  inOpenApi: boolean;
  as?: string;
  note: string;
}

export interface CallSpec {
  phase: number;
  method: 'GET' | 'POST' | 'PATCH';
  /** Address as listed in the phase (":id" or "{id}", with or without /api). */
  template: string;
  /** Parameters as listed in the phase, e.g. ['query:status', 'body:note', 'body:evidenceRef?'] (path params come from the template). */
  listed?: string[];
  as: Actor;
  /** Concrete address (without /api). Omit when the call cannot be made - give untestable instead. */
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
  expect: number | number[];
  group?: Group;
  /** Extra contract check on the reply; return a message when it does not hold (counts as FAILURE). */
  check?: (r: ApiResult<any>) => string | undefined;
  /** Reason the call cannot be made (NOT TESTABLE). */
  untestable?: string;
  note?: string;
}

export interface Actor { name: string; client: ApiClient }

interface DocParam { name: string; in: Where; required: boolean }
interface DocCall { name: string; auth: boolean; view: string; params: DocParam[] }

const DATA = path.resolve(__dirname, '..', 'data');
const host = () => new URL(apiBaseUrl()).host;
const cacheFile = (suffix: string) => path.join(DATA, 'cache', `${host()}.${suffix}`);

/** "/api/devices/units/:id/status" -> "/devices/units/{}/status" */
export function normalise(template: string): string {
  return template.replace(/^\/api/, '').replace(/\/$/, '').replace(/:[A-Za-z]+|\{[^}]+\}/g, '{}') || '/';
}

/** Persistent test data for the sweep (reused across runs; destructive calls consume and replace it). */
export const fixtures = {
  read(): Record<string, any> {
    try { return JSON.parse(fs.readFileSync(cacheFile('api-fixtures.json'), 'utf8')); } catch { return {}; }
  },
  write(patch: Record<string, any>) {
    const next = { ...fixtures.read(), ...patch, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(cacheFile('api-fixtures.json')), { recursive: true });
    fs.writeFileSync(cacheFile('api-fixtures.json'), JSON.stringify(next, null, 2));
  },
};

export class ApiSweep {
  readonly results: CallResult[] = [];
  private readonly done = new Map<string, CallResult>();
  private readonly docs = new Map<string, DocCall>();
  private openApi = new Map<string, { query: string[]; path: string[] }>();
  readonly skip = new Set((process.env.API_SKIP ?? '').toLowerCase().split(/[,\s]+/).filter(Boolean));
  scrapedAt = '';

  constructor() {
    const info = JSON.parse(fs.readFileSync(path.join(DATA, 'api', 'api-information.json'), 'utf8'));
    this.scrapedAt = info.scrapedAt;
    for (const [key, call] of Object.entries<DocCall>(info.calls)) {
      const [method, address] = key.split(' ');
      this.docs.set(`${method} ${normalise(address)}`, call);
    }
  }

  /** Loads the live OpenAPI (falls back to the copy in api/spec/openapi.json). */
  async loadOpenApi(request: APIRequestContext) {
    let spec: any;
    const res = await request.get(`${apiBaseUrl()}/docs/json`).catch(() => undefined);
    if (res?.ok()) spec = await res.json();
    else spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'api', 'spec', 'openapi.json'), 'utf8'));
    for (const [p, ops] of Object.entries<any>(spec.paths)) {
      for (const [m, op] of Object.entries<any>(ops)) {
        const params = (op.parameters ?? []) as { in: string; name: string }[];
        this.openApi.set(`${m.toUpperCase()} ${normalise(p)}`, {
          query: params.filter(x => x.in === 'query').map(x => x.name),
          path: params.filter(x => x.in === 'path').map(x => x.name),
        });
      }
    }
  }

  /** Runs one call (once per sweep), classifies it and records the result. Returns the reply when made. */
  async call(spec: CallSpec): Promise<ApiResult<any> | undefined> {
    const key = `${spec.method} ${normalise(spec.template)}`;
    const label = `${spec.method} /api${spec.template.replace(/^\/api/, '').replace(/:([A-Za-z]+)/g, '{$1}')}`;
    const doc = this.docs.get(key);
    const oa = this.openApi.get(key);
    const base = { phase: spec.phase, call: label, documented: !!doc, inOpenApi: !!oa, as: spec.as.name };

    const earlier = this.done.get(key);
    if (earlier && earlier.phase !== spec.phase) {
      this.add({ ...base, outcome: 'SHARED', status: earlier.status, note: `run in Phase ${earlier.phase}: ${earlier.outcome}` });
      return undefined;
    }
    if (spec.group && this.skip.has(spec.group)) {
      this.add({ ...base, outcome: 'NOT RUN', note: `skipped: API_SKIP=${spec.group}` });
      return undefined;
    }
    if (spec.untestable || !spec.path) {
      this.add({ ...base, outcome: 'NOT TESTABLE', note: spec.untestable ?? 'no address' });
      return undefined;
    }

    const r = await test.step(`${spec.as.name}: ${spec.method} ${spec.path}`, () => send(spec));
    const notes: string[] = [];
    if (spec.note) notes.push(spec.note);
    const signature = this.signature(spec, doc, oa, r);
    const expected = ([] as number[]).concat(spec.expect);
    // No such route: a bare 404 problem (title only). A missing record carries a detail ("Recall … not found").
    const routeMissing = r.status === 404 && !(r.problem as any)?.detail;
    const contract = expected.includes(r.status) ? spec.check?.(r) : undefined;

    let outcome: Outcome;
    if (routeMissing) { outcome = 'DOES NOT EXIST'; notes.unshift('route answers 404 (no such route)'); }
    else if (!doc) { outcome = 'DOES NOT EXIST'; notes.unshift(`not on /cer/api-information${oa ? ' (served; in OpenAPI)' : ''}`); }
    else if (signature.length) outcome = 'PARAMETER MISMATCH';
    else if (!expected.includes(r.status) || contract) outcome = 'FAILURE';
    else outcome = 'SUCCESS';

    // Undocumented calls still report what the live call did, so the documentation gap is the only finding.
    if (!routeMissing) {
      if (!expected.includes(r.status)) notes.push(`expected ${expected.join('/')}, got ${r.status}: ${brief(r)}`);
      if (contract) notes.push(contract);
      if (outcome !== 'PARAMETER MISMATCH' && signature.length) notes.push(...signature);
      if (outcome === 'PARAMETER MISMATCH') notes.unshift(...signature);
    }
    const result = this.add({ ...base, outcome, status: r.status, note: notes.join('; ') });
    this.done.set(key, result);
    return r;
  }

  /** Differences between the listed parameters, the documented ones and what the server accepted. */
  private signature(spec: CallSpec, doc: DocCall | undefined, oa: { query: string[]; path: string[] } | undefined, r: ApiResult<any>): string[] {
    const listed = (spec.listed ?? []).map(s => {
      const [where, raw] = s.split(':') as [Where, string];
      return { in: where, name: raw.replace(/\?$/, ''), required: !raw.endsWith('?') };
    });
    const out: string[] = [];
    const known = (where: Where): string[] | undefined => {
      if (doc) return doc.params.filter(p => p.in === where).map(p => p.name);
      if (oa && where === 'query') return oa.query;
      return undefined; // bodies are not documented anywhere else
    };
    for (const where of ['query', 'body'] as Where[]) {
      const mine = listed.filter(p => p.in === where);
      const theirs = known(where);
      if (!theirs || !mine.length) continue;
      const missing = mine.filter(p => !theirs.includes(p.name)).map(p => p.name);
      if (missing.length) out.push(`listed ${where} ${missing.join(', ')} not in the ${doc ? 'API information' : 'OpenAPI'} signature (${theirs.join(', ') || 'none'})`);
      if (doc) {
        const req = doc.params.filter(p => p.in === where && p.required && !mine.some(m => m.name === p.name)).map(p => p.name);
        if (req.length) out.push(`API information requires ${where} ${req.join(', ')}, not in the phase list`);
        const optional = mine.filter(m => !m.required && doc.params.some(p => p.in === where && p.name === m.name && p.required)).map(m => m.name);
        if (optional.length) out.push(`listed as optional but required by API information: ${optional.join(', ')}`);
      }
    }
    const docPath = doc ? doc.params.filter(p => p.in === 'path').length : oa?.path.length;
    const myPath = (spec.template.match(/:[A-Za-z]+|\{[^}]+\}/g) ?? []).length;
    if (docPath !== undefined && docPath !== myPath) out.push(`path parameters: listed ${myPath}, documented ${docPath}`);
    // The server rejecting fields we sent is a mismatch whatever the documentation says.
    const errors = ((r.problem as any)?.errors ?? []) as { field?: string; code?: string; message?: string }[];
    if ([400, 422].includes(r.status) && errors.length) {
      out.push(`server rejected the listed parameters: ${errors.map(e => `${e.field ?? '?'} ${e.code ?? ''} ${e.message ?? ''}`.trim()).join(' | ')}`);
    }
    return out;
  }

  private add(result: CallResult): CallResult {
    this.results.push(result);
    test.info().annotations.push({ type: 'api', description: `${result.outcome} - ${result.call}${result.status ? ` (${result.status})` : ''} as ${result.as}${result.note ? ` - ${result.note}` : ''}` });
    if (result.outcome === 'FAILURE' || result.outcome === 'PARAMETER MISMATCH') {
      reportIssue(`API ${result.outcome}: ${result.call} - ${result.note}`);
      expect.soft(result.outcome, `${result.call}: ${result.note}`).toBe('SUCCESS');
    }
    return result;
  }

  /** Note that test data had to be set up or corrected through the API (shown in the report). */
  setupNote(phase: number, note: string) {
    test.info().annotations.push({ type: 'api setup', description: note });
    this.results.push({ phase, call: '(set-up)', outcome: 'SUCCESS', documented: true, inOpenApi: true, note });
  }

  /** Writes the latest results (JSON + Markdown) and attaches the phase tables to the report. */
  async save(phase?: number) {
    const rows = phase === undefined ? this.results : this.results.filter(r => r.phase === phase);
    const md = toMarkdown(rows, this.scrapedAt, [...this.skip]);
    await test.info().attach(phase === undefined ? 'api-results.md' : `phase-${phase}-api-results.md`, { body: md, contentType: 'text/markdown' });
    fs.mkdirSync(path.dirname(cacheFile('api-results.json')), { recursive: true });
    fs.writeFileSync(cacheFile('api-results.json'), JSON.stringify({ at: new Date().toISOString(), scrapedAt: this.scrapedAt, skip: [...this.skip], results: this.results }, null, 2));
    fs.writeFileSync(cacheFile('api-results.md'), toMarkdown(this.results, this.scrapedAt, [...this.skip]));
  }
}

async function send(spec: CallSpec): Promise<ApiResult<any>> {
  const c = spec.as.client;
  if (spec.method === 'GET') return c.get(spec.path!, spec.headers);
  if (spec.method === 'PATCH') return c.patch(spec.path!, spec.body ?? {}, spec.headers);
  return c.post(spec.path!, spec.body, spec.headers);
}

export function brief(r: ApiResult<any>): string {
  const p = r.problem as any;
  if (p && typeof p === 'object') return `${p.title ?? ''} ${p.detail ?? p.message ?? ''}`.trim().slice(0, 200);
  return JSON.stringify(r.body ?? p ?? '').slice(0, 200);
}

function toMarkdown(rows: CallResult[], scrapedAt: string, skip: string[]): string {
  const order: Outcome[] = ['SUCCESS', 'FAILURE', 'DOES NOT EXIST', 'PARAMETER MISMATCH', 'NOT RUN', 'NOT TESTABLE', 'SHARED'];
  const calls = rows.filter(r => r.call !== '(set-up)');
  const counts = order.map(o => `${o}: ${calls.filter(r => r.outcome === o).length}`).join(' | ');
  const lines = [`# API sweep - ${new Date().toISOString()}`, '', `Documentation: /cer/api-information scraped ${scrapedAt}${skip.length ? ` | API_SKIP=${skip.join(',')}` : ''}`, '', counts, ''];
  for (const phase of [...new Set(rows.map(r => r.phase))].sort()) {
    lines.push(`## Phase ${phase}`, '', '| Call | Result | Status | As | Note |', '|---|---|---|---|---|');
    for (const r of rows.filter(x => x.phase === phase)) {
      lines.push(`| ${r.call} | ${r.outcome} | ${r.status ?? ''} | ${r.as ?? ''} | ${r.note.replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
