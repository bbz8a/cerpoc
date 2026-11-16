import fs from 'fs';
import path from 'path';
import { AUTH_RULES, RegisterRequest } from '../api/models/auth';
import { events } from '../utils/ledger';

/**
 * Self-registration test data.
 *
 * Emails come from data/register.emails.json (registration is allowlisted, so
 * addresses are supplied, not generated). Emails already registered successfully
 * are recorded in the local cache (event 'account.registered') and skipped.
 * The password is GLOBAL_TEST_PASSWORD from .env - never stored in the repo,
 * known to the user so the new account can be used manually.
 */
const EMAILS_FILE = path.resolve(__dirname, '..', 'data', 'register.emails.json');

export function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** GLOBAL_TEST_PASSWORD from .env, validated against the API's 12-200 rule. */
export function globalTestPassword(): string {
  const p = process.env.GLOBAL_TEST_PASSWORD ?? '';
  if (p.length < AUTH_RULES.passwordMin || p.length > AUTH_RULES.passwordMax) {
    throw new Error(`GLOBAL_TEST_PASSWORD in .env must be ${AUTH_RULES.passwordMin}-${AUTH_RULES.passwordMax} characters`);
  }
  return p;
}

/** All emails in data/register.emails.json (empty if the file is missing or empty). */
export function inputEmails(): string[] {
  if (!fs.existsSync(EMAILS_FILE)) return [];
  const text = fs.readFileSync(EMAILS_FILE, 'utf8').trim();
  if (!text) return [];
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error('data/register.emails.json must be a JSON array of email strings');
  return list.map(String).map(e => e.trim()).filter(Boolean);
}

/** Emails already registered successfully (from the local cache). */
export function usedEmails(): Set<string> {
  return new Set(events('account.registered').map(e => String(e.email).toLowerCase()));
}

/** Input emails not yet used. */
export function unusedEmails(): string[] {
  const used = usedEmails();
  return inputEmails().filter(e => !used.has(e.toLowerCase()));
}

/** Display name derived from the email, e.g. test.admin.cer@gmail.com -> "AUTO test.admin.cer". */
function displayNameFor(email: string): string {
  return `AUTO ${email.split('@')[0]}`.slice(0, AUTH_RULES.displayNameMax);
}

/** Next unused email from the input file as a RegisterRequest, or null if none are left. */
export function nextRegisterRequest(): RegisterRequest | null {
  const email = unusedEmails()[0];
  return email ? { email, displayName: displayNameFor(email), password: globalTestPassword() } : null;
}

/**
 * Request for NEGATIVE tests only (no account is created): a reserved example.com
 * address that is never a real inbox nor allowlisted. Uses GLOBAL_TEST_PASSWORD
 * when set, else a generated one.
 */
export function buildInvalidRegisterRequest(overrides: Partial<RegisterRequest> = {}): RegisterRequest {
  const id = uniqueId();
  const email = `auto.reg.${id}@example.com`;
  let password: string;
  try { password = globalTestPassword(); } catch { password = `Auto!${id}Pw9`; }
  return { email, displayName: displayNameFor(email), password, ...overrides };
}
