import { test, expect } from '@playwright/test';
import { ApiClient, ApiResult, AuthApi } from '../../../api';
import { buildInvalidRegisterRequest, inputEmails, nextRegisterRequest } from '../../../dynamic.data/account.builder';
import { reportIssue } from '../../../utils/issues';
import { record } from '../../../utils/ledger';

/**
 * POST /auth/register  (RegiGov API 0.1.0)
 *   body: { email (email, <=254), displayName (1-200), password (12-200) }
 *   202 { message } - account created pending email verification
 *   validation failure - spec documents 422; the API currently returns 400 with
 *   errors: [{ field, code, message }]. The mismatch is reported as an issue.
 *   422 not_allowed - email not on the registration ALLOWLIST (not in the spec)
 *
 * Success test: next unused email from data/register.emails.json, password
 * GLOBAL_TEST_PASSWORD (.env). Successful registrations are cached
 * ('account.registered') and that email is not used again. No unused email -> skipped.
 */

/** Validation rejection: 422 per spec (400 accepted and reported), naming the offending field. */
function expectValidationError(result: ApiResult<unknown>, field: string) {
  expect([400, 422], JSON.stringify(result.problem)).toContain(result.status);
  if (result.status !== 422) {
    reportIssue(`POST /auth/register validation returned ${result.status}; the OpenAPI spec documents 422`);
  }
  expect(result.problem?.title).toBe('Validation failed');
  const errors = (result.problem?.errors ?? []) as { field?: string }[];
  expect(errors.map(e => e.field)).toContain(field);
}

test.describe('POST /auth/register', () => {
  test('registers a new user from the email list (202, pending verification)', async ({ request }) => {
    const registration = nextRegisterRequest();
    test.skip(!registration, inputEmails().length
      ? 'Nothing to do: every email in data/register.emails.json is already registered (see cache)'
      : 'Nothing to do: data/register.emails.json is empty');
    test.info().annotations.push({ type: 'register email', description: registration!.email });

    const result = await new AuthApi(new ApiClient(request)).register(registration!);

    expect(result.status, JSON.stringify(result.problem)).toBe(202);
    expect(result.body.message).toBeTruthy();
    record({ event: 'account.registered', email: registration!.email, displayName: registration!.displayName, status: 'pending_verification' });
  });

  test('rejects an email that is not on the registration allowlist (422)', async ({ request }) => {
    const result = await new AuthApi(new ApiClient(request)).register(buildInvalidRegisterRequest());

    expect(result.status, JSON.stringify(result.problem)).toBe(422);
    expect(result.problem?.detail).toBe('Registration is not open for this email address');
    const errors = (result.problem?.errors ?? []) as { field?: string; code?: string }[];
    expect(errors).toContainEqual(expect.objectContaining({ field: 'email', code: 'not_allowed' }));
  });

  test('rejects a password shorter than 12 characters', async ({ request }) => {
    expectValidationError(await new AuthApi(new ApiClient(request)).register(buildInvalidRegisterRequest({ password: 'Short!1a' })), 'password');
  });

  test('rejects an invalid email address', async ({ request }) => {
    expectValidationError(await new AuthApi(new ApiClient(request)).register(buildInvalidRegisterRequest({ email: 'not-an-email' })), 'email');
  });
});
