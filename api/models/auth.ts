/**
 * /auth request and response models - from the OpenAPI spec published at
 * https://cerpoc.regigov.au/api/docs/json (RegiGov API 0.1.0, copy in api/spec/openapi.json).
 * Field limits are noted per field; AUTH_RULES holds them for test data.
 */

export const AUTH_RULES = {
  emailMax: 254,
  displayNameMin: 1,
  displayNameMax: 200,
  passwordMin: 12,
  passwordMax: 200,
  usernameMax: 200,
  tokenMin: 20,
  tokenMax: 200,
} as const;

/** POST /auth/register -> 202 RegisterResponse | 405 | 422 (validation) */
export interface RegisterRequest {
  /** email format, max 254 */
  email: string;
  /** 1-200 characters */
  displayName: string;
  /** 12-200 characters */
  password: string;
}

/** 202 body shared by register / resend-verification / forgot-password */
export interface MessageResponse {
  message: string;
}
export type RegisterResponse = MessageResponse;

/** POST /auth/login -> 200 LoginResponse | 401 | 403 | 405 */
export interface LoginRequest {
  /** 1-200 characters */
  username: string;
  /** 1-200 characters */
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresAt: string; // date-time
  user: Record<string, unknown>;
}

/** GET /auth/me (bearer) -> 200 MeResponse | 401 */
export interface MeResponse {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  participantId: string | null;
  workbench: 'cer' | 'participant' | 'applicant';
}

/** GET /auth/config -> 200 */
export interface AuthConfig {
  provider: 'local' | string;
  selfRegistration?: boolean;
  passwordReset?: boolean;
  [key: string]: unknown;
}

/** POST /auth/password (bearer) -> 204 | 401 | 403 | 405 */
export interface ChangePasswordRequest {
  currentPassword: string;
  /** 12-200 characters */
  newPassword: string;
}

/** POST /auth/verify-email -> 200 { verified: true } | 400 | 405 */
export interface VerifyEmailRequest {
  /** 20-200 characters */
  token: string;
}
export interface VerifyEmailResponse {
  verified: true;
}

/** POST /auth/resend-verification and /auth/forgot-password -> 202 MessageResponse | 405 | 503 */
export interface EmailRequest {
  /** email format, max 254 */
  email: string;
}

/** POST /auth/reset-password -> 204 | 400 | 405 */
export interface ResetPasswordRequest {
  /** 20-200 characters */
  token: string;
  /** 12-200 characters */
  newPassword: string;
}
