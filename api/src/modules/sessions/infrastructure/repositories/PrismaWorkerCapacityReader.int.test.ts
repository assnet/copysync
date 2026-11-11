import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import type { WorkerCapacityPlanRow } from '../../domain/contracts/IWorkerCapacityReader';
import { PrismaWorkerCapacityReader } from './PrismaWorkerCapacityReader';

/**
 * Capacidade por plano (WSCALE-09) contra Postgres local, com `TimeZone` ≠ UTC para provar o relógio
 * do lease. Planos com sufixo próprio; o grupo "sem plano" é comparado por diferença com a leitura
 * anterior ao cenário (outros arquivos podem deixar tenants sem plano).
 */
const reader = new PrismaWorkerCapacityReader(prisma);
const stamp = Date.now();
const PLAN_A = `INT_CAP_A_${stamp}`;
const PLAN_B = `INT_CAP_B_${stamp}`;
const PLAN_EMPTY = `INT_CAP_E_${stamp}`;
const WA = 'whatsapp_sessions';
const TG = 'telegram_sessions';
const MIN = 60_000;
const tenantIds: string[] = [];
let dbName = '';
let before: WorkerCapacityPlanRow | undefined;
let rows: WorkerCapacityPlanRow[] = [];

const at = (ms: number) => new Date(Date.now() + ms);
const tenant = async (planSlug: string | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
  const t = await prisma.tenant.create({ data: { name: 'int-cap', slug: `int-cap-${stamp}-${tenantIds.length}`, planSlug, status } });
  tenantIds.push(t.id);
  return t.id;
};
const ent = (tenantId: string, key: string, value: Prisma.InputJsonValue | typeof Prisma.JsonNull) =>
  prisma.tenantEntitlement.create({ data: { tenantId, key, value } });
const live = { status: 'CONNECTED' as const, ownerWorkerId: 'w1', leaseUntil: at(10 * MIN) };
const session = (tenantId: string, data: Partial<Prisma.SessionUncheckedCreateInput> = {}) =>
  prisma.session.create({ data: { tenantId, name: 'int-cap', status: 'DISCONNECTED', ...data } });
const plan = (slug: string | null) => rows.find((r) => r.planSlug === slug);

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  before = (await reader.readByPlan()).find((r) => r.planSlug === null);

  // Plano A: número, string, JSON null, ausente, não numérico; suspenso fora.
  const a1 = await tenant(PLAN_A);
  await ent(a1, WA, 3);
  await ent(a1, TG, '2');
  await session(a1, live);
  await session(a1, { status: 'CONNECTED', ownerWorkerId: 'w1', leaseUntil: at(-MIN) }); // lease vencido
  await session(a1, {});
  await session(a1, { ...live, engine: 'telegram' });
  await session(a1, { ...live, deletedAt: new Date() }); // apagada
  const a2 = await tenant(PLAN_A);
  await ent(a2, WA, Prisma.JsonNull);
  const a3 = await tenant(PLAN_A, 'SUSPENDED');
  await ent(a3, WA, 100);
  await ent(a3, TG, 100);
  await session(a3, live);
  const a4 = await tenant(PLAN_A);
  await ent(a4, WA, 'abc');
  await ent(a4, TG, true);

  // Plano B: preset 10/5, tenant com linha própria só no WhatsApp.
  await prisma.planEntitlementPreset.createMany({
    data: [
      { planSlug: PLAN_B, key: WA, value: 10 },
      { planSlug: PLAN_B, key: TG, value: 5 },
      { planSlug: PLAN_EMPTY, key: WA, value: 1 },
    ],
  });
  const b1 = await tenant(PLAN_B);
  await ent(b1, WA, 2);

  // Plano só com preset e tenant suspenso.
  const e1 = await tenant(PLAN_EMPTY, 'SUSPENDED');
  await ent(e1, WA, 1);
  await session(e1, live);

  // Sem plano: string com espaços.
  const n1 = await tenant(null);
  await ent(n1, WA, ' 4 ');
  await session(n1, live);

  rows = await reader.readByPlan();
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.planEntitlementPreset.deleteMany({ where: { planSlug: { in: [PLAN_B, PLAN_EMPTY] } } });
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('readByPlan', () => {
  it('conexão roda com TimeZone ≠ UTC', async () => {
    const [r] = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(r!.tz).toBe('America/Sao_Paulo');
  });

  it('soma número e string, ilimitado para nulo/ausente/não numérico, suspenso fora, lease vivo + CONNECTED', () => {
    expect(plan(PLAN_A)).toEqual({
      planSlug: PLAN_A,
      tenants: 3,
      contracted: { whatsapp: 3, telegram: 2 },
      unlimitedTenants: { whatsapp: 2, telegram: 2 },
      created: { whatsapp: 3, telegram: 1 },
      connected: { whatsapp: 1, telegram: 1 },
    });
  });

  it('linha do tenant vale sobre o preset; sem linha = ilimitado (o preset não é fallback)', () => {
    expect(plan(PLAN_B)).toMatchObject({
      tenants: 1,
      contracted: { whatsapp: 2, telegram: 0 },
      unlimitedTenants: { whatsapp: 0, telegram: 1 },
    });
  });

  it('plano com preset e sem tenant ativo sai zerado', () => {
    const zero = { whatsapp: 0, telegram: 0 };
    expect(plan(PLAN_EMPTY)).toEqual({
      planSlug: PLAN_EMPTY, tenants: 0, contracted: zero, unlimitedTenants: zero, created: zero, connected: zero,
    });
  });

  it('planSlug nulo vira o grupo "sem plano", por último', () => {
    const now = plan(null)!;
    const z = { whatsapp: 0, telegram: 0 };
    const b = before ?? { planSlug: null, tenants: 0, contracted: z, unlimitedTenants: z, created: z, connected: z };
    expect(now.tenants - b.tenants).toBe(1);
    expect(now.contracted.whatsapp - b.contracted.whatsapp).toBe(4);
    expect(now.created.whatsapp - b.created.whatsapp).toBe(1);
    expect(now.connected.whatsapp - b.connected.whatsapp).toBe(1);
    expect(rows.at(-1)!.planSlug).toBeNull();
  });

  it('saída sem identificador de tenant', () => {
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    expect([...keys].sort()).toEqual(['connected', 'contracted', 'created', 'planSlug', 'tenants', 'unlimitedTenants']);
  });
});
