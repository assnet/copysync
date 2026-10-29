import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { linkRotationRoutes } from './linkRotation.routes';
import { linkDomainAdminRoutes } from './linkDomainAdmin.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaLinkRotationRepository } from '../../infrastructure/repositories/PrismaLinkRotationRepository';
import { PrismaLinkDomainRepository } from '../../infrastructure/repositories/PrismaLinkDomainRepository';
import { PrismaLinkClickRepository } from '../../infrastructure/repositories/PrismaLinkClickRepository';
import { PrismaLinkRotationGroupCatalog } from '../../infrastructure/repositories/PrismaLinkRotationGroupCatalog';
import { CreateLinkRotationUseCase } from '../../application/use-cases/CreateLinkRotationUseCase';
import { RenameLinkRotationUseCase } from '../../application/use-cases/RenameLinkRotationUseCase';
import { SaveLinkRotationGroupsUseCase } from '../../application/use-cases/SaveLinkRotationGroupsUseCase';
import { LinkSlugTakenError } from '../../../../shared/errors/internal/LinkRotationErrors';
import type { LinkRotationWithGroups } from '../../domain/entities/LinkRotation';
import {
  LinkDomainStatus,
  LinkRotationGroupLinkSource,
  LinkRotationGroupStatus,
  LinkRotationStatus,
  LinkRotationStrategy,
} from '../../domain/enums/LinkRotationEnums';

/*
 * Contrato HTTP (padrão chat.routes.test): Fastify de verdade, sem banco. Prisma vazio, auth e
 * tenant falsos; os use cases reais rodam sobre repositórios espionados no protótipo.
 */
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: auth.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
  },
}));

const PREFIX = '/api/link-rotation';
const ADMIN = '/api/admin/link-domains';
const T0 = new Date('2026-10-29T12:00:00.000Z');

function rotationOf(tenantId: string, over: Partial<LinkRotationWithGroups> = {}): LinkRotationWithGroups {
  return {
    id: 'rot-1', tenantId, sessionId: 'sess-1', domainId: 'dom-1', slug: 'promo',
    status: LinkRotationStatus.ACTIVE, strategy: LinkRotationStrategy.BALANCED, title: null,
    clickCount: 12, lastClickAt: T0, allFullNotifiedAt: null, createdAt: T0, updatedAt: T0,
    groups: [{
      id: 'g-1', tenantId, rotationId: 'rot-1', conversationId: 'conv-1', groupJid: '1203',
      position: 0, weight: 1, capacity: 1000, inviteCode: 'ABC', linkSource: LinkRotationGroupLinkSource.AUTO,
      status: LinkRotationGroupStatus.ACTIVE, memberCount: 300, memberCountAt: T0, clicksSinceSync: 2,
      clickCount: 12, lastClickAt: T0,
    }],
    ...over,
  } as LinkRotationWithGroups;
}

/** Repositório "de banco" só com a rotação do tenant-b: tenant-a nunca a enxerga. */
function onlyTenantB() {
  vi.spyOn(PrismaLinkRotationRepository.prototype, 'findById').mockImplementation(
    async (tenantId: string) => (tenantId === 'tenant-b' ? rotationOf('tenant-b') : null),
  );
}

let app: FastifyInstance;

beforeEach(async () => {
  auth.isSuperAdmin = false;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(linkRotationRoutes, { prefix: PREFIX });
  await app.register(linkDomainAdminRoutes, { prefix: ADMIN });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('POST /link-rotation', () => {
  it('no limite do plano responde 403 PLAN_LIMIT_REACHED com key e limit', async () => {
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(1);
    vi.spyOn(PrismaLinkRotationRepository.prototype, 'countByTenant').mockResolvedValue(1);
    const create = vi.spyOn(PrismaLinkRotationRepository.prototype, 'create');

    const res = await app.inject({
      method: 'POST', url: PREFIX, payload: { sessionId: 'sess-1', domainId: 'dom-1', slug: 'promo' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotations', limit: 1 } });
    expect(create).not.toHaveBeenCalled();
  });

  it('nome ocupado responde 409 LINK_SLUG_TAKEN com sugestões', async () => {
    vi.spyOn(CreateLinkRotationUseCase.prototype, 'execute').mockRejectedValue(new LinkSlugTakenError(['promo-1', 'promo-vip']));

    const res = await app.inject({
      method: 'POST', url: PREFIX, payload: { sessionId: 'sess-1', domainId: 'dom-1', slug: 'promo' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'LINK_SLUG_TAKEN', meta: { suggestions: ['promo-1', 'promo-vip'] } });
  });

  it.each([
    ['sem slug', { sessionId: 'sess-1', domainId: 'dom-1' }],
    ['estratégia fora da lista', { sessionId: 's', domainId: 'd', slug: 'promo', strategy: 'FASTEST' }],
    ['título acima de 80', { sessionId: 's', domainId: 'd', slug: 'promo', title: 'x'.repeat(81) }],
  ])('%s responde 400 sem chegar ao use case', async (_caso, payload) => {
    const execute = vi.spyOn(CreateLinkRotationUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'POST', url: PREFIX, payload });
    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('validação de corpo', () => {
  it('PATCH não aceita PAUSED_BY_PLAN nem corpo vazio', async () => {
    const a = await app.inject({ method: 'PATCH', url: `${PREFIX}/rot-1`, payload: { status: 'PAUSED_BY_PLAN' } });
    const b = await app.inject({ method: 'PATCH', url: `${PREFIX}/rot-1`, payload: {} });
    expect([a.statusCode, b.statusCode]).toEqual([400, 400]);
  });

  it('rename sem slug responde 400', async () => {
    const execute = vi.spyOn(RenameLinkRotationUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/rot-1/rename`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('PUT de grupos exige conversationId ou groupJid', async () => {
    const res = await app.inject({ method: 'PUT', url: `${PREFIX}/rot-1/groups`, payload: { groups: [{ weight: 2 }] } });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /:id/groups', () => {
  it('acima do limite de grupos responde 403 com limit, sem criar conversa', async () => {
    vi.spyOn(PrismaLinkRotationRepository.prototype, 'findById').mockResolvedValue(rotationOf('tenant-a'));
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(1);
    const save = vi.spyOn(SaveLinkRotationGroupsUseCase.prototype, 'execute');

    const res = await app.inject({
      method: 'PUT', url: `${PREFIX}/rot-1/groups`,
      payload: { groups: [{ conversationId: 'conv-1' }, { groupJid: '9999' }] },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotation_groups', limit: 1 } });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('isolamento por tenant', () => {
  it.each([
    ['GET', '/rot-1/stats'],
    ['GET', '/rot-1/groups'],
    ['DELETE', '/rot-1'],
    ['POST', '/rot-1/groups/g-1/refresh'],
  ] as const)('%s %s de rotação de outro tenant responde 404', async (method, path) => {
    onlyTenantB();
    const res = await app.inject({ method, url: `${PREFIX}${path}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('LINK_ROTATION_NOT_FOUND');
  });
});

describe('GET /:id/stats', () => {
  it('devolve total, 7 dias e por grupo', async () => {
    vi.spyOn(PrismaLinkRotationRepository.prototype, 'findById').mockResolvedValue(rotationOf('tenant-a'));
    const last7 = vi.spyOn(PrismaLinkClickRepository.prototype, 'countLast7Days').mockResolvedValue(5);
    vi.spyOn(PrismaLinkClickRepository.prototype, 'countLast7DaysByGroup').mockResolvedValue(new Map([['g-1', 5]]));
    vi.spyOn(PrismaLinkRotationGroupCatalog.prototype, 'findGroups').mockResolvedValue([
      { conversationId: 'conv-1', sessionId: 'sess-1', groupJid: '1203', name: 'VIP 1' },
    ]);

    const res = await app.inject({ method: 'GET', url: `${PREFIX}/rot-1/stats` });

    expect(res.statusCode).toBe(200);
    expect(last7.mock.calls[0]![0]).toBe('tenant-a');
    expect(res.json().data).toEqual({
      rotationId: 'rot-1', clickCount: 12, clicksLast7Days: 5, lastClickAt: T0.toISOString(),
      groups: [{
        id: 'g-1', conversationId: 'conv-1', groupName: 'VIP 1', status: 'ACTIVE',
        clickCount: 12, clicksLast7Days: 5, memberCount: 300, capacity: 1000,
      }],
    });
  });
});

describe('/admin/link-domains', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['PATCH', '/dom-1'],
    ['DELETE', '/dom-1'],
    ['POST', '/dom-1/probe'],
  ] as const)('%s%s sem super-admin é recusado', async (method, path) => {
    const list = vi.spyOn(PrismaLinkDomainRepository.prototype, 'list');
    const res = await app.inject({ method, url: `${ADMIN}${path}`, payload: method === 'GET' || method === 'DELETE' ? undefined : { hostname: 'x.com' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(list).not.toHaveBeenCalled();
  });

  it('super-admin lista com datas em ISO', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaLinkDomainRepository.prototype, 'list').mockResolvedValue([{
      id: 'dom-1', hostname: 'copysync.com.br', status: LinkDomainStatus.ACTIVE, landingUrl: null,
      reservedNames: [], lastProbeAt: null, lastProbeOk: null, createdAt: T0, updatedAt: T0,
    }]);
    const res = await app.inject({ method: 'GET', url: ADMIN });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items[0]).toMatchObject({ hostname: 'copysync.com.br', createdAt: T0.toISOString() });
  });

  it('PATCH aceita landingUrl null; status fora da lista responde 400', async () => {
    auth.isSuperAdmin = true;
    const domain = {
      id: 'dom-1', hostname: 'copysync.com.br', status: LinkDomainStatus.ACTIVE, landingUrl: null,
      reservedNames: [], lastProbeAt: null, lastProbeOk: null, createdAt: T0, updatedAt: T0,
    };
    vi.spyOn(PrismaLinkDomainRepository.prototype, 'findById').mockResolvedValue({ ...domain, landingUrl: 'https://x.com' });
    const update = vi.spyOn(PrismaLinkDomainRepository.prototype, 'update').mockResolvedValue(domain);

    const ok = await app.inject({ method: 'PATCH', url: `${ADMIN}/dom-1`, payload: { landingUrl: null } });
    expect(ok.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith('dom-1', { landingUrl: null });

    const bad = await app.inject({ method: 'PATCH', url: `${ADMIN}/dom-1`, payload: { status: 'GONE' } });
    expect(bad.statusCode).toBe(400);
  });
});
