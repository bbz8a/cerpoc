import path from 'path';

export const AUTH_DIR = path.join(__dirname, '.auth');

/** sessionStorage key holding the bearer token (not captured by storageState). */
export const TOKEN_KEY = 'regigov.accessToken';

export const AUTH_USERS = [
  { key: 'admin',     userEnv: 'CER_ADMIN_USERNAME',             passEnv: 'CER_ADMIN_PASSWORD' },
  { key: 'officer',   userEnv: 'CER_OFFICER_USERNAME',           passEnv: 'CER_OFFICER_PASSWORD' },
  { key: 'applicant', userEnv: 'APPLICANT_PARTICIPANT_USERNAME', passEnv: 'APPLICANT_PARTICIPANT_PASSWORD' },
] as const;

export type AuthUserKey = (typeof AUTH_USERS)[number]['key'];

/** Saved session: { token } - kept in playwright/.auth (git-ignored). */
export const authFile = (key: AuthUserKey) => path.join(AUTH_DIR, `${key}.json`);
