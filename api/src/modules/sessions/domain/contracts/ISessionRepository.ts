import type { Session } from '../entities/Session';
import type { SessionStatus } from '../enums/SessionStatus';

export interface ISessionRepository {
  findById(id: string, tenantId: string): Promise<Session | null>;
  findAllByTenant(tenantId: string): Promise<Session[]>;
  create(session: Session): Promise<Session>;
  updateStatus(id: string, tenantId: string, status: SessionStatus): Promise<void>;
  updatePhone(id: string, tenantId: string, phone: string): Promise<void>;
  delete(id: string, tenantId: string): Promise<void>;
}
