import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaInfraTenantUsageReader } from './PrismaInfraTenantUsageReader';

/** Foto por tenant para a sessão-hora (T13), com `TimeZone` ≠ UTC para provar o relógio do lease. */
const reader = new PrismaInfraTenantUsageReader(prisma);
const stamp = Date.now();
const MIN = 60_000;
const ids: string[] = [];
let dbName = '';
const at = (ms: number) => new Date(Date.now() + ms);
const tenant = async (planSlug: string | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
  const t = await prisma.tenant.create({ data: { name: 'int-ic-tu', slug: `int-ic-tu-${stamp}-${ids.length}`, planSlug, status } });
  ids.push(t.id);
  return t.id;
};
const ent = (tenantId: string, key: string, value: Prisma.InputJsonValue | typeof Prisma.JsonNull) =>
  prisma.tenantEntitlement.create({ data: { tenantId, key, value } });
const live = { status: 'CONNECTED' as const, ownerWorkerId: 'w1', leaseUntil: at(10 * MIN) };
const session = (tenantId: string, data: Partial<Prisma.SessionUncheckedCreateInput> = {}) =>
  prisma.session.create({ data: { tenantId, name: 'int-ic-tu', status: 'DISCONNECTED', ...data } });

let a = '', b = '', c = '', s = '';
beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  a = await tenant('COPYSYNC_PRO');
  await ent(a, 'whatsapp_sessions', 3);
  await ent(a, 'telegram_sessions', '2');
  await session(a, live);
  await session(a, { ...live, engine: 'telegram' });
  await session(a, { status: 'CONNECTED', ownerWorkerId: 'w1', leaseUntil: at(-MIN) }); // lease vencido
  await session(a, { ...live, ownerWorkerId: null }); // sem dono
  await session(a, { ...live, deletedAt: new Date() }); // apagada
  b = await tenant('COPYSYNC_PRO'); // ilimitado nos dois canais → preset 1 + 1
  await ent(b, 'whatsapp_sessions', Prisma.JsonNull);
  c = await tenant(null); // sem plano: 1 por canal; texto não numérico = ilimitado
  await ent(c, 'whatsapp_sessions', '1e400');
  s = await tenant('COPYSYNC_PRO', 'SUSPENDED');
  await session(s, live);
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('PrismaInfraTenantUsageReader', () => {
  it('conectadas com lease vivo e contratadas efetivas por tenant ACTIVE (ilimitado = preset)', async () => {
    const rows = (await reader.readHour()).filter((r) => ids.includes(r.tenantId));
    const by = new Map(rows.map((r) => [r.tenantId, r]));
    expect(by.get(a)).toEqual({ tenantId: a, planSlug: 'COPYSYNC_PRO', connectedSessions: 2, contractedSessions: 5 });
    expect(by.get(b)).toEqual({ tenantId: b, planSlug: 'COPYSYNC_PRO', connectedSessions: 0, contractedSessions: 2 });
    expect(by.get(c)).toEqual({ tenantId: c, planSlug: null, connectedSessions: 0, contractedSessions: 2 });
    expect(by.has(s)).toBe(false);
  });
});
