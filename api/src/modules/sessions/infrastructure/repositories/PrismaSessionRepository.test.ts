import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Transação em memória: registra a ordem lock → contagem → criação. */
const db = vi.hoisted(() => {
  const state = {
    used: 0, ops: [] as string[], lockArgs: [] as unknown[], countWhere: {} as Record<string, unknown>,
    updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>, updateCount: 1,
  };
  const T0 = new Date('2026-11-02T12:00:00Z');
  const tx = {
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => { state.ops.push('lock'); state.lockArgs = values; return 1; },
    session: {
      count: async ({ where }: { where: Record<string, unknown> }) => { state.ops.push('count'); state.countWhere = where; return state.used; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.ops.push('create');
        return {
          id: 's-new', phone: null, externalRef: null, lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null,
          deletedAt: null, createdAt: T0, updatedAt: T0, ...data,
        };
      },
    },
  };
  const row = {
    id: 's1', tenantId: 't1', name: 'Ofertas', engine: 'baileys', phone: null, declaredPhone: null, externalRef: null,
    status: 'DISCONNECTED', lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null, deletedAt: null,
    createdAt: T0, updatedAt: T0,
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    session: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push(args);
        return { count: state.updateCount };
      },
      findUniqueOrThrow: async () => row,
    },
  };
  return { state, prisma };
});
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: db.prisma }));

import { PrismaSessionRepository } from './PrismaSessionRepository';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

const data = { tenantId: 't1', name: 'Ofertas', engine: 'baileys', declaredPhone: null };
const limit = { key: 'whatsapp_sessions', limit: 2, engine: 'baileys' };

beforeEach(() => {
  db.state.used = 0;
  db.state.ops = [];
  db.state.lockArgs = [];
  db.state.updates = [];
  db.state.updateCount = 1;
});

describe('PrismaSessionRepository.createWithinLimit', () => {
  it('trava o tenant antes de contar e cria abaixo do limite', async () => {
    db.state.used = 1;
    const session = await new PrismaSessionRepository().createWithinLimit(data, limit);
    expect(db.state.ops).toEqual(['lock', 'count', 'create']);
    expect(db.state.lockArgs).toEqual(['session-limit:t1']);
    expect(db.state.countWhere).toMatchObject({ tenantId: 't1', engine: 'baileys', deletedAt: null });
    expect(session).toMatchObject({ id: 's-new', tenantId: 't1', status: 'PENDING' });
  });

  it('limite atingido lança PLAN_LIMIT_REACHED sem criar', async () => {
    db.state.used = 2;
    await expect(new PrismaSessionRepository().createWithinLimit(data, limit)).rejects.toBeInstanceOf(PlanLimitReachedError);
    expect(db.state.ops).toEqual(['lock', 'count']);
  });
});

describe('PrismaSessionRepository.markConnectRequested', () => {
  it('grava só quando não há pedido (COALESCE), filtrando id + tenantId e sessão não excluída', async () => {
    await new PrismaSessionRepository().markConnectRequested('s1', 't1');
    expect(db.state.updates).toHaveLength(1);
    const [{ where, data: set }] = db.state.updates;
    expect(where).toEqual({ id: 's1', tenantId: 't1', deletedAt: null, connectRequestedAt: null });
    expect(set.connectRequestedAt).toBeInstanceOf(Date);
  });

  it('pedido já existente (zero linhas) não lança nem sobrescreve', async () => {
    db.state.updateCount = 0;
    await expect(new PrismaSessionRepository().markConnectRequested('s1', 't1')).resolves.toBeUndefined();
  });
});

describe('PrismaSessionRepository.updateStatus — connectRequestedAt', () => {
  it('clearConnectRequest grava null na mesma escrita do status, filtrando id + tenantId', async () => {
    await new PrismaSessionRepository().updateStatus('s1', 't1', { status: 'DISCONNECTED', clearConnectRequest: true });
    expect(db.state.updates).toHaveLength(1);
    expect(db.state.updates[0].where).toEqual({ id: 's1', tenantId: 't1' });
    expect(db.state.updates[0].data).toEqual({ status: 'DISCONNECTED', connectRequestedAt: null });
  });

  it('sem clearConnectRequest não toca no campo', async () => {
    await new PrismaSessionRepository().updateStatus('s1', 't1', { status: 'CONNECTED' });
    await new PrismaSessionRepository().updateStatus('s1', 't1', { status: 'CONNECTED', clearConnectRequest: false });
    for (const u of db.state.updates) expect(u.data).not.toHaveProperty('connectRequestedAt');
  });

  it('outro tenant (zero linhas) lança SESSION_NOT_FOUND', async () => {
    db.state.updateCount = 0;
    await expect(
      new PrismaSessionRepository().updateStatus('s1', 't2', { status: 'DISCONNECTED', clearConnectRequest: true }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
