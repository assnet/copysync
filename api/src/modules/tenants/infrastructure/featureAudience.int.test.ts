import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { errorHandler } from '../../../shared/http/errorHandler';
import { SetFeatureAudienceUseCase } from '../application/use-cases/SetFeatureAudienceUseCase';
import { featureAudienceReader, prismaFeatureAudienceTransaction } from './featureAudience';
import { FEATURE_AUDIENCE_SETTINGS_KEY, PrismaFeatureAudienceRepository } from './repositories/PrismaFeatureAudienceRepository';
import { offerHuntRoutes } from '../../campaigns/presentation/routes/offerHunt.routes';

/*
 * Audiência do caçador pela flag do admin, de ponta a ponta no Postgres descartável: grava pelo use case
 * (flag + AuditLog no mesmo commit) e as rotas reais do caçador (tenantHook + membership + entitlement reais;
 * só o JWT é falso) passam a abrir para o usuário comum do tenant MAX no pedido seguinte.
 */
const auth = vi.hoisted(() => ({ userId: '', isSuperAdmin: false }));
vi.mock('../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => { request.user = { userId: auth.userId, isSuperAdmin: auth.isSuperAdmin }; },
}));

const stamp = Date.now();
const uc = new SetFeatureAudienceUseCase(prismaFeatureAudienceTransaction);
const originalEnv = env.OFFER_HUNTER_AUDIENCE;
let app: FastifyInstance;
let tenantId = '';
let adminId = '';
let before: { value: unknown } | null = null;

const call = (url: string) => app.inject({ method: 'GET', url: `/api/offer-hunts${url}`, headers: { 'x-tenant-id': tenantId } });
const row = () => prisma.platformSetting.findUnique({ where: { key: FEATURE_AUDIENCE_SETTINGS_KEY } });

beforeAll(async () => {
  before = await row();
  await prisma.platformSetting.deleteMany({ where: { key: FEATURE_AUDIENCE_SETTINGS_KEY } });
  tenantId = (await prisma.tenant.create({ data: { name: 'int aud', slug: `int-aud-${stamp}`, planSlug: 'COPYSYNC_MAX' } })).id;
  await prisma.tenantEntitlement.create({ data: { tenantId, key: 'offer_hunter_enabled', value: true } });
  const user = await prisma.user.create({ data: { email: `int-aud-${stamp}@int.test`, name: 'u', passwordHash: 'x' } });
  await prisma.userTenant.create({ data: { userId: user.id, tenantId, role: 'ADMIN' } });
  auth.userId = user.id;
  adminId = (await prisma.user.create({ data: { email: `int-aud-admin-${stamp}@int.test`, name: 'a', passwordHash: 'x', isSuperAdmin: true } })).id;
  (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = 'super_admin';
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(offerHuntRoutes, { prefix: '/api/offer-hunts' });
  await app.ready();
});

afterEach(() => { auth.isSuperAdmin = false; });

afterAll(async () => {
  (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = originalEnv;
  await app.close();
  await prisma.platformSetting.deleteMany({ where: { key: FEATURE_AUDIENCE_SETTINGS_KEY } });
  if (before) await prisma.platformSetting.create({ data: { key: FEATURE_AUDIENCE_SETTINGS_KEY, value: before.value as object } });
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [auth.userId, adminId] } } });
  await prisma.$disconnect();
});

describe('feature_audience (offer_hunter_enabled)', () => {
  it('sem linha: vale a env (super_admin) → usuário MAX com entitlement fica fora', async () => {
    expect(await featureAudienceReader().superAdminOnly('offer_hunter_enabled')).toBe(true);
    expect((await call('/access')).json().data).toEqual({ visible: false });
    expect((await call('/settings')).statusCode).toBe(403);
  });

  it('admin desliga → usuário MAX passa a acessar /access e rotas; auditoria com meta.audience', async () => {
    expect(await uc.execute({ key: 'offer_hunter_enabled', superAdminOnly: false, actorUserId: adminId })).toEqual({ key: 'offer_hunter_enabled', superAdminOnly: false });
    expect((await row())?.value).toEqual({ offer_hunter_enabled: false });
    expect((await call('/access')).json().data).toEqual({ visible: true });
    const settings = await call('/settings');
    expect(settings.statusCode).toBe(200);
    const audit = await prisma.auditLog.findMany({ where: { userId: adminId, action: 'PLAN_ENTITLEMENT_CHANGED' } });
    expect(audit.map((a) => a.meta)).toEqual([{ key: 'offer_hunter_enabled', audience: { superAdminOnly: false } }]);
  });

  it('flag desligada sem o entitlement → fora', async () => {
    await prisma.tenantEntitlement.update({ where: { tenantId_key: { tenantId, key: 'offer_hunter_enabled' } }, data: { value: false } });
    expect((await call('/access')).json().data).toEqual({ visible: false });
    expect((await call('/settings')).statusCode).toBe(403);
    await prisma.tenantEntitlement.update({ where: { tenantId_key: { tenantId, key: 'offer_hunter_enabled' } }, data: { value: true } });
  });

  it('admin liga de novo → só super admin (vence a env entitled)', async () => {
    (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = 'entitled';
    await uc.execute({ key: 'offer_hunter_enabled', superAdminOnly: true, actorUserId: adminId });
    expect((await call('/access')).json().data).toEqual({ visible: false });
    auth.isSuperAdmin = true;
    expect((await call('/access')).json().data).toEqual({ visible: true });
    (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = 'super_admin';
  });

  it('merge: outra chave e valor não-objeto não se perdem nem quebram', async () => {
    await prisma.platformSetting.update({ where: { key: FEATURE_AUDIENCE_SETTINGS_KEY }, data: { value: { offer_hunter_enabled: true, future_key: true } } });
    await new PrismaFeatureAudienceRepository().set('offer_hunter_enabled', false, adminId);
    expect((await row())?.value).toEqual({ offer_hunter_enabled: false, future_key: true });
    await prisma.platformSetting.update({ where: { key: FEATURE_AUDIENCE_SETTINGS_KEY }, data: { value: 'lixo' } });
    expect(await new PrismaFeatureAudienceRepository().get()).toEqual({});
    await new PrismaFeatureAudienceRepository().set('offer_hunter_enabled', true, adminId);
    expect((await row())?.value).toEqual({ offer_hunter_enabled: true });
  });

  it('auditoria falha (autor inexistente) → flag não muda', async () => {
    await expect(uc.execute({ key: 'offer_hunter_enabled', superAdminOnly: false, actorUserId: 'no-such-user' })).rejects.toThrow();
    expect((await row())?.value).toEqual({ offer_hunter_enabled: true });
  });
});
