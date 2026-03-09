import type { Session } from '../entities/Session';
import type { SessionStatus } from '../enums/SessionStatus';

export interface SessionCreateData {
  tenantId: string;
  name: string;
  engine: string;
}

export interface SessionStatusUpdate {
  status: SessionStatus;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
}

export interface ISessionRepository {
  create(data: SessionCreateData): Promise<Session>;
  findById(id: string, tenantId: string): Promise<Session | null>;
  findAllByTenant(tenantId: string): Promise<Session[]>;
  /**
   * Updates status (and optional timestamps).
   * Callers must pre-validate tenantId ownership via findById.
   */
  updateStatus(id: string, tenantId: string, update: SessionStatusUpdate): Promise<Session>;
  updatePhone(id: string, tenantId: string, phone: string): Promise<Session>;
  updateExternalRef(id: string, tenantId: string, externalRef: string): Promise<Session>;
  softDelete(id: string, tenantId: string): Promise<void>;
}
