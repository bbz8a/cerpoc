import { ApiClient, ApiResult } from './ApiClient';
import {
  AuditEventList, Incident, IncidentList, IncidentStatus, IncidentStatusChange, IncidentSubmission,
  ParticipantUser, ParticipantUserInvite, ParticipantUserList, ParticipantUserUpdate,
} from './models/phase4';

/**
 * /participants/{me|:id}/users - self:users (participant_admin, for "me") or users:admin (cer_admin, for :id).
 * Pass participantId = 'me' for the caller's own organisation.
 */
export class ParticipantUsersApi {
  constructor(private readonly client: ApiClient) {}

  list(participantId = 'me'): Promise<ApiResult<ParticipantUserList>> {
    return this.client.get(`/participants/${participantId}/users`);
  }

  invite(body: ParticipantUserInvite, participantId = 'me'): Promise<ApiResult<ParticipantUser>> {
    return this.client.post(`/participants/${participantId}/users`, body);
  }

  update(userId: string, body: ParticipantUserUpdate, participantId = 'me'): Promise<ApiResult<ParticipantUser>> {
    return this.client.patch(`/participants/${participantId}/users/${userId}`, body);
  }
}

/** /incidents - incidents:read / incidents:write (participants and CER), incidents:manage (CER status). */
export class IncidentsApi {
  constructor(private readonly client: ApiClient) {}

  list(filter: { status?: IncidentStatus; q?: string; modelId?: string; participantId?: string } = {}): Promise<ApiResult<IncidentList>> {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    return this.client.get(`/incidents${qs ? `?${qs}` : ''}`);
  }

  get(id: string): Promise<ApiResult<Incident>> {
    return this.client.get(`/incidents/${id}`);
  }

  report(body: IncidentSubmission): Promise<ApiResult<Incident>> {
    return this.client.post('/incidents', body);
  }

  addNote(id: string, note: string): Promise<ApiResult<Incident>> {
    return this.client.post(`/incidents/${id}/notes`, { note });
  }

  changeStatus(id: string, body: IncidentStatusChange): Promise<ApiResult<Incident>> {
    return this.client.post(`/incidents/${id}/status`, body);
  }
}

/** GET /audit/events (audit:read - CER only). */
export class AuditApi {
  constructor(private readonly client: ApiClient) {}

  events(filter: { action?: string; actor?: string; entityId?: string; from?: string; limit?: number } = {}): Promise<ApiResult<AuditEventList>> {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    return this.client.get(`/audit/events${qs ? `?${qs}` : ''}`);
  }
}
