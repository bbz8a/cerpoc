/**
 * Login accounts. Any account can act in any role (tester role switcher), so
 * tests pick ACCOUNTS by key and switch role as needed. The .env variable names
 * are historical and do not restrict the role an account can take.
 *
 *   admin     -> CER_ADMIN_*              (indigitise account)
 *   officer   -> CER_OFFICER_*            (outlook account)
 *   applicant -> APPLICANT_PARTICIPANT_*  (third account)
 *
 * The server remembers the active role per ACCOUNT, so two parties in one flow
 * must use two different accounts.
 */
export const ACCOUNT_KEYS = ['admin', 'officer', 'applicant'] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];

const ENV: Record<AccountKey, [string, string]> = {
  admin:     ['CER_ADMIN_USERNAME', 'CER_ADMIN_PASSWORD'],
  officer:   ['CER_OFFICER_USERNAME', 'CER_OFFICER_PASSWORD'],
  applicant: ['APPLICANT_PARTICIPANT_USERNAME', 'APPLICANT_PARTICIPANT_PASSWORD'],
};

export interface Account {
  key: AccountKey;
  username: string;
  password: string;
}

export function getAccount(key: string): Account {
  if (!(ACCOUNT_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown account "${key}" - use one of: ${ACCOUNT_KEYS.join(', ')}`);
  }
  const [u, p] = ENV[key as AccountKey];
  const username = process.env[u];
  const password = process.env[p];
  if (!username || !password) throw new Error(`Missing ${u} / ${p} in .env`);
  return { key: key as AccountKey, username, password };
}

/** Two accounts for a two-party flow; fails if both resolve to the same login. */
export function getAccountPair(firstKey: string, secondKey: string): [Account, Account] {
  const a = getAccount(firstKey);
  const b = getAccount(secondKey);
  if (a.username.toLowerCase() === b.username.toLowerCase()) {
    throw new Error(`"${firstKey}" and "${secondKey}" are the same login (${a.username}) - use two different accounts`);
  }
  return [a, b];
}
