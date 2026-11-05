import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  localEngine: vi.fn(),
  active: null as unknown,
  ctor: vi.fn(),
}));

vi.mock('../../../messaging/infrastructure/localEngineContainer', () => ({ localEngine: h.localEngine }));
vi.mock('../../../../shared/engine/activeEngine', () => ({ getActiveEngine: () => h.active }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../infrastructure/lease/sessionLeaseContainer', () => ({
  sessionLeaseContainer: () => ({ release: { execute: vi.fn() } }),
}));
vi.mock('../../application/use-cases/CreateSessionUseCase', () => ({
  CreateSessionUseCase: class { constructor(...a: unknown[]) { h.ctor('create', a); } },
}));
vi.mock('../../application/use-cases/ListSessionsUseCase', () => ({
  ListSessionsUseCase: class { constructor(...a: unknown[]) { h.ctor('list', a); } },
}));

import type { FastifyInstance } from 'fastify';
import { sessionRoutes } from './session.routes';

/** Fastify falso: registra rotas sem compilar schema (os `$ref` vivem no app). */
const fakeApp = () => new Proxy({}, { get: () => vi.fn() }) as unknown as FastifyInstance;

beforeEach(() => {
  vi.clearAllMocks();
  h.active = null;
});

describe('sessionRoutes', () => {
  it('importar o módulo não monta engine', () => {
    expect(h.localEngine).not.toHaveBeenCalled();
    expect(h.ctor).not.toHaveBeenCalled();
  });

  it('registro usa a engine ativa do papel e nunca localEngine()', async () => {
    const engine = { kind: 'remote', enabledEngines: new Set(['baileys', 'telegram']) };
    h.active = engine;
    await sessionRoutes(fakeApp());
    expect(h.localEngine).not.toHaveBeenCalled();
    const list = h.ctor.mock.calls.find((c) => c[0] === 'list')![1] as unknown[];
    expect(list[1]).toBe(engine);
    const create = h.ctor.mock.calls.find((c) => c[0] === 'create')![1] as unknown[];
    expect(create[3]).toBe(engine.enabledEngines);
  });

  it('sem engine composta falha no registro', async () => {
    await expect(sessionRoutes(fakeApp())).rejects.toThrow(/composeForRole/);
  });
});
