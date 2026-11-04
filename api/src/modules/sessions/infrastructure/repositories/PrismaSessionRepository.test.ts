import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Transação em memória: registra a ordem lock → contagem → criação. */
const db = vi.hoisted(() => {
  const state = { used: 0, ops: [] as string[], lockArgs: [] as unknown[], countWhere: {} as Record<string, unknown> };
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
  const prisma = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { state, prisma };
});
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: db.prisma }));

import { PrismaSessionRepository } from './PrismaSessionRepository';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';

const data = { tenantId: 't1', name: 'Ofertas', engine: 'baileys', declaredPhone: null };
const limit = { key: 'whatsapp_sessions', limit: 2, engine: 'baileys' };

beforeEach(() => {
  db.state.used = 0;
  db.state.ops = [];
  db.state.lockArgs = [];
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
