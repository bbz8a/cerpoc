/**
 * Phase 4 models (self-service users, incidents, audit) - from api/spec/openapi.json
 * (RegiGov API 0.1.0, published at <origin>/api/docs/json).
 */

// ---------------------------------------------------------------- participant users

export type ParticipantRole = 'participant_admin' | 'participant_user';

/** GET /participants/{me|:id}/users -> { items } */
export interface ParticipantUser {
  id: string;
  username: string;
  displayName: string;
  role: ParticipantRole;
  provider: 'local' | 'entra';
  disabled: boolean;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantUserList { items: ParticipantUser[] }

/**
 * POST /participants/{me|:id}/users -> 201 | 409 (username taken) | 400 (validation).
 * username: 3-120 chars, ^[a-z0-9][a-z0-9._@+-]*$ ; password: 12-200 chars.
 */
export interface ParticipantUserInvite {
  username: string;
  displayName: string;
  role: ParticipantRole;
  password?: string;
  email?: string;
  requireEmailVerification?: boolean;
}

/**
 * PATCH /participants/{me|:id}/users/:userId -> 200 | 404 (not in scope) |
 * 409 "A participant must keep at least one active administrator" / "You cannot change or disable your own account here".
 */
export interface ParticipantUserUpdate {
  role?: ParticipantRole;
  disabled?: boolean;
}

// ---------------------------------------------------------------- incidents

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';

/** CER moves incidents strictly along this path; anything else is 409. */
export const INCIDENT_FLOW: IncidentStatus[] = ['open', 'acknowledged', 'investigating', 'resolved', 'closed'];

/**
 * POST /incidents -> 201 Incident | 404 (device not in the reporter's scope) | 400/422.
 * At least one of unitId / installationId / modelId. title 3-200, description 10-5000.
 */
export interface IncidentSubmission {
  unitId?: string;
  installationId?: string;
  modelId?: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  occurredOn?: string; // YYYY-MM-DD
  evidenceRef?: string;
}

export interface IncidentSummary {
  id: string; // CER-N-...
  status: IncidentStatus;
  severity: IncidentSeverity;
  title: string;
  modelId: string;
  modelNumber: string;
  manufacturerId: string;
  manufacturerName: string;
  unitId: string | null;
  unitSerial: string | null;
  installationId: string | null;
  installationNmi: string | null;
  reportedByParticipantId: string | null;
  reportedByParticipantName: string | null;
  occurredOn: string | null;
  recallId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentEvent {
  id: number;
  kind: 'raised' | 'note' | 'status';
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  note: string | null;
  actorId: string | null;
  actorName: string | null;
  actorParticipantId: string | null;
  createdAt: string;
}

export interface Incident extends IncidentSummary {
  description: string;
  evidenceRef: string | null;
  reportedByUserId: string | null;
  reportedByUserName: string | null;
  events: IncidentEvent[];
}

export interface IncidentList { items: IncidentSummary[] }

/** POST /incidents/:id/status (CER) -> 200 | 403 (participant) | 409 (illegal transition). note 3-5000. */
export interface IncidentStatusChange {
  status: Exclude<IncidentStatus, 'open'>;
  note: string;
}

// ---------------------------------------------------------------- audit

/** GET /audit/events?action=access.denied (audit:read - CER) */
export interface AuditEvent {
  id: number;
  occurredAt: string;
  actorUsername: string | null;
  action: string;
  outcome: string;
  participantId: string | null;
  detail: { url?: string; method?: string; status?: number; [k: string]: unknown } | null;
  [k: string]: unknown;
}

export interface AuditEventList { items: AuditEvent[] }
