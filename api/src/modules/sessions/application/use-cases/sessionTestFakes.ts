import { vi } from 'vitest';
import { Session, type SessionProps } from '../../domain/entities/Session';
import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

const NOW = new Date('2026-10-26T12:00:00Z');

export function makeSession(overrides: Partial<SessionProps> = {}): Session {
  return new Session({
    id: 's1',
    tenantId: 't1',
    name: 'Ofertas',
    engine: 'baileys',
    phone: null,
    declaredPhone: null,
    externalRef: null,
    status: 'PENDING',
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastSeenAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

export function makeSessionRepo(session: Session | null = makeSession()) {
  return {
    create: vi.fn(async (data) => makeSession({ ...data })),
    findById: vi.fn(async () => session),
    updateStatus: vi.fn(async () => session),
  } as unknown as ISessionRepository & Record<'create' | 'findById' | 'updateStatus', ReturnType<typeof vi.fn>>;
}

export function makeAuditRepo() {
  return { create: vi.fn(async () => undefined) } as unknown as IAuditLogRepository & {
    create: ReturnType<typeof vi.fn>;
  };
}

export function makeEngine(pairingCode: string | null = null) {
  return {
    requestPairingCode: vi.fn(async () => ({ pairingCode })),
  } as unknown as IMessagingEngine & { requestPairingCode: ReturnType<typeof vi.fn> };
}
