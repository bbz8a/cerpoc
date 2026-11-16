import { ApiClient, ApiResult } from './ApiClient';
import {
  AuthConfig, ChangePasswordRequest, EmailRequest, LoginRequest, LoginResponse, MeResponse,
  MessageResponse, RegisterRequest, RegisterResponse, ResetPasswordRequest, VerifyEmailRequest, VerifyEmailResponse,
} from './models/auth';

/**
 * /auth endpoints (RegiGov API 0.1.0). Expected statuses per the spec:
 *   GET  /auth/config               200
 *   POST /auth/login                200 | 401 | 403 | 405
 *   GET  /auth/me             (bearer) 200 | 401
 *   POST /auth/password       (bearer) 204 | 401 | 403 | 405
 *   POST /auth/logout         (bearer) 204 | 401
 *   POST /auth/register             202 | 405 | 422
 *   POST /auth/verify-email         200 | 400 | 405
 *   POST /auth/resend-verification  202 | 405 | 503
 *   POST /auth/forgot-password      202 | 405 | 503
 *   POST /auth/reset-password       204 | 400 | 405
 */
export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  config(): Promise<ApiResult<AuthConfig>> {
    return this.client.get('/auth/config');
  }

  /** Logs in; on success the client keeps the bearer token for later calls. */
  async login(credentials: LoginRequest): Promise<ApiResult<LoginResponse>> {
    const result = await this.client.post<LoginResponse>('/auth/login', credentials);
    if (result.ok) this.client.setToken(result.body.accessToken);
    return result;
  }

  me(): Promise<ApiResult<MeResponse>> {
    return this.client.get('/auth/me');
  }

  changePassword(body: ChangePasswordRequest): Promise<ApiResult<void>> {
    return this.client.post('/auth/password', body);
  }

  async logout(): Promise<ApiResult<void>> {
    const result = await this.client.post<void>('/auth/logout');
    if (result.ok) this.client.setToken(undefined);
    return result;
  }

  /** Self-registration: account is created pending email verification. */
  register(body: RegisterRequest): Promise<ApiResult<RegisterResponse>> {
    return this.client.post('/auth/register', body);
  }

  verifyEmail(body: VerifyEmailRequest): Promise<ApiResult<VerifyEmailResponse>> {
    return this.client.post('/auth/verify-email', body);
  }

  /** Always 202 with a neutral message (does not reveal whether the account exists). */
  resendVerification(body: EmailRequest): Promise<ApiResult<MessageResponse>> {
    return this.client.post('/auth/resend-verification', body);
  }

  /** Always 202 with a neutral message (does not reveal whether the account exists). */
  forgotPassword(body: EmailRequest): Promise<ApiResult<MessageResponse>> {
    return this.client.post('/auth/forgot-password', body);
  }

  resetPassword(body: ResetPasswordRequest): Promise<ApiResult<void>> {
    return this.client.post('/auth/reset-password', body);
  }
}
