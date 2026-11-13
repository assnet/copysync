import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { offerHuntRoutes } from './offerHunt.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { env } from '../../../../shared/config/env';
import { PrismaEntitlementReader } from '../../infrastructure/repositories/PrismaEntitlementReader';
import { PrismaOfferHuntRepository } from '../../infrastructure/repositories/hunter/PrismaOfferHuntRepository';
import { PrismaOfferGeneratorConfigRepository } from '../../infrastructure/repositories/PrismaOfferGeneratorConfigRepository';
import { RunOfferHuntUseCase, type RunOfferHuntOutput } from '../../application/use-cases/hunter/RunOfferHuntUseCase';
import { ListOfferHuntsUseCase } from '../../application/use-cases/hunter/OfferHuntCrudUseCases';
import { ResendHuntFindUseCase } from '../../application/use-cases/hunter/ResendHuntFindUseCase';
import { OfferHuntResendPendingError } from '../../../../shared/errors/internal/OfferHuntErrors';
import { GetOfferHunterUsageUseCase } from '../../application/use-cases/hunter/OfferHunterInfoUseCases';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { AT_TOKEN, MEMBER, NOW, makeHunt } from '../../application/use-cases/hunter/hunterTestFakes';
import type { OfferHuntFind } from '../../domain/hunter/OfferHunt';

/* Contrato HTTP sem banco: Prisma vazio, auth/tenant falsos, repositórios e use cases espionados no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false, memberOf: true }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: auth.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { headers: Record<string, unknown>; tenantContext?: unknown }) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined) ?? 'tenant-a';
    request.tenantContext = { userId: 'user-a', tenantId, role: auth.isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN', isSuperAdmin: auth.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/resolveMembership', async () => {
  const { ForbiddenError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    resolveMembership: async (userId: string, tenantId: string, isSuperAdmin: boolean) => {
      if (!auth.memberOf && !isSuperAdmin) throw new ForbiddenError('no');
      return { userId, tenantId, role: 'ADMIN', isSuperAdmin };
    },
  };
});

const URL = '/api/offer-hunts';
const RUN_BASE = {
  id: 'run-1', tenantId: 'tenant-a', provider: 'SHEIN' as const, huntId: 'hunt-1', trigger: 'MANUAL' as const, status: 'SUCCEEDED' as const, seenCount: 5, matchedCount: 2,
  chosenCount: 1, sentCount: 0, aiUsed: false, aiFallback: false, rejectedBy: { minSales: 3 }, errorCode: null, startedAt: NOW, finishedAt: NOW,
};
const ID = 'hunt-1';
/** Toda rota com portão (método, path, corpo). */
const GATED: [string, string, object?][] = [
  ['GET', '/'], ['POST', '/', { name: 'x' }], ['GET', `/${ID}`], ['PUT', `/${ID}`, { topN: 2 }], ['DELETE', `/${ID}`],
  ['POST', `/${ID}/pause`], ['POST', `/${ID}/resume`], ['POST', `/${ID}/run`], ['GET', `/${ID}/runs`], ['GET', `/${ID}/runs/run-1`], ['GET', `/${ID}/finds`],
  ['POST', '/finds/f1/approve'], ['POST', '/finds/f1/dismiss'], ['POST', '/finds/f1/resend'], ['GET', '/usage'], ['GET', '/options'], ['GET', '/options/providers'], ['GET', '/settings'],
  ['PUT', '/settings', { sessionId: 's1', conversationId: 'c1' }],
];

let app: FastifyInstance;
let ent: Record<string, boolean | number>;
const bodies: string[] = [];
const originalAudience = env.OFFER_HUNTER_AUDIENCE;
const setAudience = (a: 'super_admin' | 'entitled') => { (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = a; };

async function call(method: string, path: string, payload?: object) {
  const res = await app.inject({ method: method as 'GET', url: `${URL}${path}`, payload, headers: { 'x-tenant-id': 'tenant-a' } });
  bodies.push(res.body);
  return res;
}

const find: OfferHuntFind = {
  id: 'f1', tenantId: 'tenant-a', huntId: ID, runId: 'run-1', status: 'PENDING_REVIEW', provider: 'SHEIN', productId: '12345678', goodsId: '12345678',
  commissionEstimated: false, skcCode: 'sk1',
  activityId: 'act1', title: 'Vestido', imageUrl: 'https://img.ltwebstatic.com/v.jpg', priceCents: 5990, originalPriceCents: 9990, discountPercent: 40, commissionPercent: 15,
  commissionCents: 898, returningCommissionPercent: 5, returningCommissionCents: 300, extraCommissionCents: 0, salesBucket: 1000,
  reviewsBucket: 100, rating: 4.8, score: 81.5, factors: [{ key: 'commission', points: 30, max: 40 }], aiReason: null,
  failureReason: null, offerId: null, resendCount: 0, lastResentAt: null, resendInFlightUntil: null, delivery: null, createdAt: NOW, updatedAt: NOW,
};

beforeEach(async () => {
  auth.isSuperAdmin = false;
  auth.memberOf = true;
  setAudience('super_admin');
  ent = { [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: true, [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: true, [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 10 };
  vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockImplementation(async (_t, k) => (typeof ent[k] === 'boolean' ? (ent[k] as boolean) : null));
  vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockImplementation(async (_t, k) => (typeof ent[k] === 'number' ? (ent[k] as number) : null));
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(offerHuntRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  // Nenhuma resposta do caçador carrega o token da Shein nem o memberId
  for (const b of bodies.splice(0)) {
    expect(b).not.toContain(AT_TOKEN);
    expect(b).not.toContain(MEMBER);
    expect(b).not.toContain('claimToken');
  }
  setAudience(originalAudience);
  vi.restoreAllMocks();
  await app.close();
});

describe('audiência super_admin (prévia)', () => {
  it('usuário comum de tenant MAX → 403 OFFER_HUNTER_UNAVAILABLE em todas, sem chamar use case', async () => {
    const list = vi.spyOn(ListOfferHuntsUseCase.prototype, 'execute');
    for (const [m, p, body] of GATED) {
      const res = await call(m, p, body);
      expect(res.statusCode, `${m} ${p}`).toBe(403);
      expect(res.json().error?.code ?? res.json().code).toBe('OFFER_HUNTER_UNAVAILABLE');
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('/access: usuário comum → 200 { visible: false }; super admin → true', async () => {
    expect((await call('GET', '/access')).json()).toEqual({ success: true, data: { visible: false } });
    auth.isSuperAdmin = true;
    expect((await call('GET', '/access')).json().data).toEqual({ visible: true });
  });

  it('super admin → 200 na lista, com presenter fechado (sem tenantId/posse)', async () => {
    auth.isSuperAdmin = true;
    vi.spyOn(PrismaOfferHuntRepository.prototype, 'listByTenant')
      .mockResolvedValue([{ ...makeHunt({ tenantId: 'tenant-a' }), claimToken: AT_TOKEN } as never]);
    const res = await call('GET', '/');
    expect(res.statusCode).toBe(200);
    const [h] = res.json().data;
    expect(h).toMatchObject({ id: ID, name: 'Maior comissão', status: 'ACTIVE' });
    expect(h.tenantId).toBeUndefined();
  });
});

describe('audiência entitled', () => {
  beforeEach(() => setAudience('entitled'));

  it('tenant sem offer_hunter_enabled → 403; /access visible false', async () => {
    ent[ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED] = false;
    expect((await call('GET', '/usage')).statusCode).toBe(403);
    expect((await call('GET', '/access')).json().data).toEqual({ visible: false });
  });

  it('tenant com entitlement → 200 (usuário comum); /access visible true; não membro → false', async () => {
    const usage = { used: 1, limit: 10, remaining: 9, runsToday: 2, runsMax: 24, resendsToday: 3, resendsMax: 10 };
    vi.spyOn(GetOfferHunterUsageUseCase.prototype, 'execute').mockResolvedValue(usage);
    const res = await call('GET', '/usage');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(usage);
    expect((await call('GET', '/access')).json().data).toEqual({ visible: true });
    auth.memberOf = false;
    expect((await call('GET', '/access')).json().data).toEqual({ visible: false });
  });
});

describe('rotas (super admin)', () => {
  beforeEach(() => { auth.isSuperAdmin = true; });

  it('POST / 6ª caçada → 409 OFFER_HUNT_LIMIT_REACHED', async () => {
    const create = vi.spyOn(PrismaOfferHuntRepository.prototype, 'createWithinLimit').mockResolvedValue(null);
    const res = await call('POST', '/', { name: 'Sexta' });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain('OFFER_HUNT_LIMIT_REACHED');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', name: 'Sexta' }), 5);
  });

  it('POST / topN fora da faixa → 400 pelo schema', async () => {
    expect((await call('POST', '/', { name: 'x', topN: 99 })).statusCode).toBe(400);
  });

  it('POST /:id/run devolve ranking com pontuação e fatores (MANUAL, tenant do contexto)', async () => {
    const out: RunOfferHuntOutput = {
      runId: 'run-1', status: 'SUCCEEDED', errorCode: null, seenCount: 30, matchedCount: 12, chosenCount: 1, sentCount: 0,
      aiUsed: true, aiFallback: false, rejectedBy: { minSales: 21, minReviews: 14, repeated: 2 },
      ranking: [{ provider: 'SHEIN', productId: '12345678', commissionEstimated: false, title: 'Vestido', imageUrl: 'https://img.ltwebstatic.com/a.jpg', priceCents: 5990,
        discountPercent: 40, commissionPercent: 20, commissionCents: 1198, returningCommissionPercent: 4.9, returningCommissionCents: 293,
        extraCommissionCents: 0, salesBucket: 1000, reviewsBucket: 500, rating: 4.8, score: 81.5,
        factors: [{ key: 'commission', points: 30, max: 40 }], aiReason: 'Boa comissão', chosen: true }],
      finds: [find], remainingToday: 9, pausedReason: null,
    };
    const exec = vi.spyOn(RunOfferHuntUseCase.prototype, 'execute').mockResolvedValue(out);
    const res = await call('POST', `/${ID}/run`);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.rejectedBy).toEqual({ minSales: 21, minReviews: 14, repeated: 2 });
    // Shein também sai com `goodsId` (= productId) para o painel anterior
    expect(data.ranking[0]).toEqual({ ...out.ranking[0], goodsId: '12345678' });
    expect(data.finds[0]).toMatchObject({ provider: 'SHEIN', productId: '12345678', goodsId: '12345678', commissionEstimated: false });
    expect(data.finds[0]).toMatchObject({ id: 'f1', score: 81.5, factors: [{ key: 'commission', points: 30, max: 40 }] });
    expect(data.finds[0].imageUrl).toBe('https://img.ltwebstatic.com/v.jpg');
    expect(data.finds[0].skcCode).toBeUndefined();
    expect(data.finds[0].tenantId).toBeUndefined();
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', huntId: ID, trigger: 'MANUAL' }));
  });

  it('GET /:id/finds com cursor inválido → 400 OFFER_HUNT_CURSOR_INVALID', async () => {
    const res = await call('GET', `/${ID}/finds?cursor=lixo`);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('OFFER_HUNT_CURSOR_INVALID');
  });

  it('GET /:id/runs sem cursor: página do servidor', async () => {
    vi.spyOn(PrismaOfferHuntRepository.prototype, 'findById').mockResolvedValue(makeHunt({ tenantId: 'tenant-a' }));
    const { PrismaOfferHuntRunRepository } = await import('../../infrastructure/repositories/hunter/PrismaOfferHuntRunRepository');
    const list = vi.spyOn(PrismaOfferHuntRunRepository.prototype, 'listByHunt').mockResolvedValue([]);
    const res = await call('GET', `/${ID}/runs?limit=500&offset=3`);
    // limit/offset do cliente são descartados (schema fechado); o tamanho é do servidor (20 + 1 de sobra)
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items: [], nextCursor: null });
    expect(list).toHaveBeenCalledWith('tenant-a', ID, { limit: 21, after: undefined });
  });

  it('GET /:id/runs: item sem ranking, com hasRanking e rejectedBy', async () => {
    vi.spyOn(PrismaOfferHuntRepository.prototype, 'findById').mockResolvedValue(makeHunt({ tenantId: 'tenant-a' }));
    const { PrismaOfferHuntRunRepository } = await import('../../infrastructure/repositories/hunter/PrismaOfferHuntRunRepository');
    vi.spyOn(PrismaOfferHuntRunRepository.prototype, 'listByHunt').mockResolvedValue([{ ...RUN_BASE, hasRanking: true }]);
    const item = (await call('GET', `/${ID}/runs`)).json().data.items[0];
    expect(item).toMatchObject({ id: 'run-1', hasRanking: true, rejectedBy: { minSales: 3 } });
    expect(item).not.toHaveProperty('ranking');
  });

  it('GET /:id/runs/:runId: execução com ranking; outro tenant/caçada → 404 OFFER_HUNT_NOT_FOUND', async () => {
    const { PrismaOfferHuntRunRepository } = await import('../../infrastructure/repositories/hunter/PrismaOfferHuntRunRepository');
    const ranking = [{ provider: 'SHEIN' as const, productId: '1', commissionEstimated: false, title: 'V', imageUrl: null, priceCents: 100, discountPercent: null, commissionPercent: 10, commissionCents: 10,
      returningCommissionPercent: null, returningCommissionCents: null, extraCommissionCents: 0, salesBucket: null, reviewsBucket: null,
      rating: null, score: 50, factors: [], aiReason: null, chosen: true }];
    const get = vi.spyOn(PrismaOfferHuntRunRepository.prototype, 'findById').mockResolvedValueOnce({ ...RUN_BASE, ranking });
    const ok = await call('GET', `/${ID}/runs/run-1`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ id: 'run-1', hasRanking: true, ranking: [{ goodsId: '1', chosen: true }] });
    expect(get).toHaveBeenCalledWith('tenant-a', ID, 'run-1');
    get.mockResolvedValueOnce(null);
    const missing = await call('GET', `/${ID}/runs/run-x`);
    expect(missing.statusCode).toBe(404);
    expect(JSON.stringify(missing.json())).toContain('OFFER_HUNT_NOT_FOUND');
  });

  it('PUT /settings com grupo de outro tenant → 404, nada gravado', async () => {
    vi.spyOn(PrismaOfferGeneratorConfigRepository.prototype, 'findSession').mockResolvedValue({ id: 's1', engine: 'baileys' } as never);
    vi.spyOn(PrismaOfferGeneratorConfigRepository.prototype, 'filterSessionGroups').mockResolvedValue([]);
    const { PrismaOfferHunterSettingsRepository } = await import('../../infrastructure/repositories/hunter/PrismaOfferHunterSettingsRepository');
    const upsert = vi.spyOn(PrismaOfferHunterSettingsRepository.prototype, 'upsert');
    const res = await call('PUT', '/settings', { sessionId: 's1', conversationId: 'c-outro' });
    expect(res.statusCode).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('GET /options?provider: marca vai ao use case (padrão SHEIN); marca desconhecida → 400', async () => {
    const { GetOfferHunterOptionsUseCase } = await import('../../application/use-cases/hunter/OfferHunterInfoUseCases');
    const exec = vi.spyOn(GetOfferHunterOptionsUseCase.prototype, 'execute').mockResolvedValue({ provider: 'MERCADO_LIVRE' } as never);
    expect((await call('GET', '/options?provider=MERCADO_LIVRE')).statusCode).toBe(200);
    expect(exec).toHaveBeenLastCalledWith('tenant-a', 'MERCADO_LIVRE');
    await call('GET', '/options');
    expect(exec).toHaveBeenLastCalledWith('tenant-a', 'SHEIN');
    expect((await call('GET', '/options?provider=SHOPEE')).statusCode).toBe(400);
  });

  it('GET /options/providers: portões por marca, sem chamar a fonte', async () => {
    const { GetOfferHunterProvidersUseCase } = await import('../../application/use-cases/hunter/OfferHunterInfoUseCases');
    const gates = { plan: true, hunterEntitlement: true, credential: false, riskAccepted: false, aiAvailable: true, destination: false };
    const items = [{ provider: 'SHEIN' as const, credentialState: 'MISSING' as const, gates }, { provider: 'MERCADO_LIVRE' as const, credentialState: 'OK' as const, gates }];
    vi.spyOn(GetOfferHunterProvidersUseCase.prototype, 'execute').mockResolvedValue({ items });
    const res = await call('GET', '/options/providers');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items });
  });

  it('POST / com provider e sourceOptions da marca; marca desconhecida → 400; filtro fora da marca → 422', async () => {
    const create = vi.spyOn(PrismaOfferHuntRepository.prototype, 'createWithinLimit')
      .mockImplementation(async (input) => ({ ...makeHunt({ tenantId: 'tenant-a' }), ...input, id: 'hunt-ml' }));
    const res = await call('POST', '/', {
      name: 'ML', provider: 'MERCADO_LIVRE', sourceOptions: { sort: 'lowest_price', extraEarningsOnly: true }, aiConfigured: true, aiIntent: 'moda',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      provider: 'MERCADO_LIVRE', sourceOptions: { sort: 'lowest_price', extraEarningsOnly: true, bestSellersOnly: null }, aiConfigured: true, aiIntent: 'moda',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ provider: 'MERCADO_LIVRE' }), 5);
    // Sem provider: Shein (API anterior)
    await call('POST', '/', { name: 'Shein' });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'SHEIN', sourceOptions: null }), 5);
    expect((await call('POST', '/', { name: 'x', provider: 'SHOPEE' })).statusCode).toBe(400);
    const bad = await call('POST', '/', { name: 'x', provider: 'MERCADO_LIVRE', filters: { minReviews: 10 } });
    expect(bad.statusCode).toBe(422);
    expect(JSON.stringify(bad.json())).toContain('filters.minReviews');
  });

  it('PUT /:id não troca a marca → 422 provider', async () => {
    vi.spyOn(PrismaOfferHuntRepository.prototype, 'findById').mockResolvedValue(makeHunt({ tenantId: 'tenant-a' }));
    const res = await call('PUT', `/${ID}`, { provider: 'MERCADO_LIVRE' });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain('provider');
  });

  it('DELETE /:id → 204', async () => {
    vi.spyOn(PrismaOfferHuntRepository.prototype, 'delete').mockResolvedValue(true);
    expect((await call('DELETE', `/${ID}`)).statusCode).toBe(204);
  });
});

describe('POST /finds/:findId/resend e envio real do achado', () => {
  beforeEach(() => { auth.isSuperAdmin = true; });

  it('200 com o achado: status do disparo, hora, grupo/sessão e contador de reenvio', async () => {
    const out = {
      ...find, status: 'SENT' as const, offerId: 'offer-2', resendCount: 1, lastResentAt: NOW,
      delivery: { dispatchStatus: 'QUEUED' as const, sentAt: null, groupName: 'Ofertas VIP', sessionName: 'Loja', failureReason: null, updatedAt: NOW },
    };
    const exec = vi.spyOn(ResendHuntFindUseCase.prototype, 'execute').mockResolvedValue(out);
    const res = await call('POST', '/finds/f1/resend');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      id: 'f1', status: 'SENT', offerId: 'offer-2', dispatchStatus: 'QUEUED', sentAt: null,
      destination: { groupName: 'Ofertas VIP', sessionName: 'Loja' }, resendCount: 1, lastResentAt: NOW.toISOString(),
    });
    expect(exec).toHaveBeenCalledWith({ tenantId: 'tenant-a', findId: 'f1' });
  });

  it('SENT com hora; sem oferta → dispatchStatus/destination null', async () => {
    const sent = { ...find, status: 'SENT' as const, offerId: 'o1', delivery: { dispatchStatus: 'SENT' as const, sentAt: NOW, groupName: 'G', sessionName: null, failureReason: null, updatedAt: NOW } };
    vi.spyOn(ResendHuntFindUseCase.prototype, 'execute').mockResolvedValueOnce(sent);
    expect((await call('POST', '/finds/f1/resend')).json().data).toMatchObject({ dispatchStatus: 'SENT', sentAt: NOW.toISOString(), destination: { groupName: 'G', sessionName: null } });
    const { OfferHuntPresenter } = await import('../presenters/OfferHuntPresenter');
    expect(OfferHuntPresenter.find(find)).toMatchObject({ dispatchStatus: null, sentAt: null, destination: null });
  });

  it('pendente → 409 OFFER_HUNT_RESEND_PENDING', async () => {
    vi.spyOn(ResendHuntFindUseCase.prototype, 'execute').mockRejectedValue(new OfferHuntResendPendingError());
    const res = await call('POST', '/finds/f1/resend');
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain('OFFER_HUNT_RESEND_PENDING');
  });
});
