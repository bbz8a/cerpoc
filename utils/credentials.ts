export type UserRole =
  | 'admin'
  | 'officer'
  | 'participant_admin'
  | 'participant_user'
  | 'applicant_manu'
  | 'applicant_inst'
  | 'readonly';

export type Credentials = {
  username: string;
  password: string;
  mapping: string;
};

export async function getCredentials(
  role: UserRole, 
): Promise<Credentials> {

  const mapping: Record<UserRole, Credentials> = {
    admin: {
      username: process.env.CER_ADMIN_USERNAME!,
      password: process.env.CER_ADMIN_PASSWORD!,
      mapping: "cer_admin",
    },
    officer: {
      username: process.env.CER_OFFICER_USERNAME!,
      password: process.env.CER_OFFICER_PASSWORD!,
      mapping: "cer_officer",
    },
    participant_admin: {
      username: process.env.APPLICANT_PARTICIPANT_USERNAME!,
      password: process.env.APPLICANT_PARTICIPANT_PASSWORD!,
      mapping: "participant_admin"
    },
    participant_user: {
      username: process.env.APPLICANT_PARTICIPANT_USERNAME!,
      password: process.env.APPLICANT_PARTICIPANT_PASSWORD!,
      mapping: "participant_user"
    },
    applicant_manu: {
      username: process.env.APPLICANT_PARTICIPANT_USERNAME!,
      password: process.env.APPLICANT_PARTICIPANT_PASSWORD!,
      mapping: "applicant"
    },
    applicant_inst: {
      username: process.env.CER_ADMIN_USERNAME!,
      password: process.env.CER_ADMIN_PASSWORD!,
      mapping: "applicant"
    },
    
    readonly: {
      username: process.env.READONLY_USERNAME!,
      password: process.env.READONLY_PASSWORD!,
      mapping: "read_only"
    },
  };

  return mapping[role];
}