import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createRouter: vi.fn(),
  bindSocketControl: vi.fn(),
  gate: { acquire: vi.fn(), release: vi.fn() },
}));

vi.mock('../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../sessions/infrastructure/repositories/PrismaSessionRepository', () => ({ PrismaSessionRepository: class {} }));
vi.mock('../../sessions/infrastructure/repositories/PrismaSessionAuthStateRepository', () => ({
  PrismaSessionAuthStateRepository: class {},
}));
vi.mock('../../chat/infrastructure/repositories/PrismaChatContactRepository', () => ({ PrismaChatContactRepository: class {} }));
vi.mock('../../chat/infrastructure/repositories/PrismaChatConversationRepository', () => ({
  PrismaChatConversationRepository: class {},
}));
vi.mock('../../chat/infrastructure/repositories/PrismaChatMessageRepository', () => ({ PrismaChatMessageRepository: class {} }));
vi.mock('../../chat/application/use-cases/IngestHistorySyncUseCase', () => ({ IngestHistorySyncUseCase: class {} }));
vi.mock('../../sessions/infrastructure/lease/sessionLeaseContainer', () => ({
  sessionLeaseContainer: () => ({ gate: h.gate, bindSocketControl: h.bindSocketControl }),
}));
vi.mock('./MessagingEngineFactory', () => ({ MessagingEngineFactory: { createRouter: h.createRouter } }));

import { localEngine } from './localEngineContainer';
import { getActiveEngine } from '../../../shared/engine/activeEngine';

describe('localEngine', () => {
  it('importar não monta engine', () => {
    expect(h.createRouter).not.toHaveBeenCalled();
    expect(getActiveEngine()).toBeNull();
  });

  it('monta uma vez: mesma instância, ativa, lease ligado ao roteador', () => {
    const router = { enabledEngines: ['baileys'] };
    h.createRouter.mockReturnValue(router);

    const a = localEngine();
    const b = localEngine();

    expect(a).toBe(router);
    expect(b).toBe(a);
    expect(getActiveEngine()).toBe(a);
    expect(h.createRouter).toHaveBeenCalledTimes(1);
    expect(h.createRouter.mock.calls[0][0].leaseGate).toBe(h.gate);
    expect(h.bindSocketControl).toHaveBeenCalledTimes(1);
    expect(h.bindSocketControl).toHaveBeenCalledWith(router);
  });
});
