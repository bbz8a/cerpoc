import { APIRequestContext, APIResponse } from '@playwright/test';
import { ProblemDetails } from './models/ProblemDetails';

/**
 * Typed result of an API call: status plus parsed body. On failure the body is
 * the RFC 7807 problem (application/problem+json).
 */
export interface ApiResult<T> {
  response: APIResponse;
  status: number;
  /** true for 2xx */
  ok: boolean;
  /** parsed JSON success body (undefined for 204 / empty) */
  body: T;
  /** parsed problem body on non-2xx */
  problem?: ProblemDetails;
}

/**
 * Base URL of the API: API_BASE_URL if set, otherwise <origin of BASE_URL>/api.
 * The origin is used because BASE_URL may include a path (e.g. .../login);
 * the app serves the API under /api - see servers in api/spec/openapi.json.
 */
export function apiBaseUrl(): string {
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL.replace(/\/$/, '');
  if (!/^https?:\/\//.test(process.env.BASE_URL ?? '')) throw new Error('Set BASE_URL (or API_BASE_URL) in .env');
  return `${new URL(process.env.BASE_URL!).origin}/api`;
}

/** Thin JSON client over Playwright's APIRequestContext (use the `request` fixture). */
export class ApiClient {
  private token?: string;

  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string = apiBaseUrl(),
  ) {}

  /** Bearer token for endpoints with bearerAuth security (e.g. from AuthApi.login). */
  setToken(token: string | undefined) {
    this.token = token;
  }

  async get<T>(endpoint: string, headers?: Record<string, string>): Promise<ApiResult<T>> {
    return this.send<T>('GET', endpoint, undefined, headers);
  }

  async post<T>(endpoint: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> {
    return this.send<T>('POST', endpoint, body, headers);
  }

  async patch<T>(endpoint: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> {
    return this.send<T>('PATCH', endpoint, body, headers);
  }

  private async send<T>(method: 'GET' | 'POST' | 'PATCH', endpoint: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const response = await this.request.fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { data: body } : {}),
    });
    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;
    return {
      response,
      status: response.status(),
      ok: response.ok(),
      body: (response.ok() ? parsed : undefined) as T,
      problem: response.ok() ? undefined : (parsed as ProblemDetails | undefined),
    };
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
