import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  localEngine: vi.fn(),
  active: null as unknown,
  ctor: vi.fn(),
  adoption: false,
  session: null as unknown,
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
  ListSessionsUseCase: class {
    constructor(...a: unknown[]) { h.ctor('list', a); }
    execute = async () => [{ session: h.session, avatarUrl: null }];
  },
}));
vi.mock('../../application/use-cases/GetSessionByIdUseCase', () => ({
  GetSessionByIdUseCase: class { execute = async () => h.session; },
}));
vi.mock('../../../../shared/config/workerAdoption', () => ({
  workerAdoptionConfig: () => ({ enabled: h.adoption, shard: null }),
}));

import type { FastifyInstance } from 'fastify';
import { sessionRoutes } from './session.routes';
import { makeSession } from '../../application/use-cases/sessionTestFakes';

/** Fastify falso: registra rotas sem compilar schema (os `$ref` vivem no app). */
const fakeApp = () => new Proxy({}, { get: () => vi.fn() }) as unknown as FastifyInstance;

beforeEach(() => {
  vi.clearAllMocks();
  h.active = null;
  h.adoption = false;
  h.session = null;
});

type Handler = (req: unknown, reply: unknown) => Promise<unknown>;

/** Fastify falso que guarda os handlers de GET por caminho. */
function recordingApp() {
  const gets = new Map<string, Handler>();
  const app = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'get' ? (path: string, _opts: unknown, handler: Handler) => gets.set(path, handler) : vi.fn(),
    },
  ) as unknown as FastifyInstance;
  return { app, gets };
}

async function callGet(path: string): Promise<Record<string, unknown>> {
  h.active = { kind: 'local', enabledEngines: new Set(['baileys']) };
  const { app, gets } = recordingApp();
  await sessionRoutes(app);
  let body: unknown;
  const reply = { status: () => reply, send: (b: unknown) => { body = b; return reply; } };
  await gets.get(path)!({ tenantContext: { tenantId: 't1' }, params: { id: 's1' } }, reply);
  return body as Record<string, unknown>;
}

/** Sessão com pedido vivo e sem dono (lease nulo). */
const orphan = () => makeSession({ status: 'DISCONNECTED', connectRequestedAt: new Date(Date.now() - 60_000), leaseUntil: null });

describe('chip aguardando capacidade (ADOPT-13)', () => {
  it('flag ligada + sessão sem dono → awaitingCapacity: true na lista e no item', async () => {
    h.adoption = true;
    h.session = orphan();
    const list = await callGet('/');
    expect((list.sessions as Array<Record<string, unknown>>)[0]!.awaitingCapacity).toBe(true);
    expect((await callGet('/:id')).awaitingCapacity).toBe(true);
  });

  it('flag desligada → false', async () => {
    h.session = orphan();
    const list = await callGet('/');
    expect((list.sessions as Array<Record<string, unknown>>)[0]!.awaitingCapacity).toBe(false);
    expect((await callGet('/:id')).awaitingCapacity).toBe(false);
  });
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
