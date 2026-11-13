import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { offerHuntAiSuggestRoutes } from './offerHuntAiSuggest.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { env } from '../../../../shared/config/env';
import { PrismaEntitlementReader } from '../../infrastructure/repositories/PrismaEntitlementReader';
import { SuggestHuntConfigUseCase, type SuggestHuntConfigOutput } from '../../application/use-cases/hunter/SuggestHuntConfigUseCase';
import { OfferHuntAiSuggestDailyLimitError } from '../../../../shared/errors/internal/OfferHuntAiErrors';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

/* Contrato HTTP sem banco: Prisma vazio, auth/tenant falsos, use case espionado no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: auth.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: auth.isSuperAdmin };
  },
}));

const URL = '/api/offer-hunts/ai-suggest';
const OUT: SuggestHuntConfigOutput = {
  draft: {
    provider: 'MERCADO_LIVRE', name: 'Moda barata', categoryId: 'MLB1430', keyword: null,
    sourceOptions: { extraEarningsOnly: true }, filters: { maxPriceCents: 5000, minCommissionPct: 10, commissionOperator: 'GTE' },
    aiEnabled: true, topN: 3,
  },
  reasons: { categoryId: 'Moda vende bem' },
  dropped: ['filters.onlyWithExtra'],
  sourceUsed: true,
  remainingToday: 4,
};

let app: FastifyInstance;
const originalAudience = env.OFFER_HUNTER_AUDIENCE;
const post = (payload: object) => app.inject({ method: 'POST', url: URL, payload });

beforeEach(async () => {
  auth.isSuperAdmin = true;
  (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = 'super_admin';
  vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockImplementation(async (_t, k) => k === ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED);
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(offerHuntAiSuggestRoutes, { prefix: '/api/offer-hunts' });
  await app.ready();
});

afterEach(async () => {
  (env as { OFFER_HUNTER_AUDIENCE: string }).OFFER_HUNTER_AUDIENCE = originalAudience;
  vi.restoreAllMocks();
  await app.close();
});

describe('POST /offer-hunts/ai-suggest', () => {
  it('200: rascunho fechado pelo presenter; tenant do contexto; pickProduct padrão false', async () => {
    const exec = vi.spyOn(SuggestHuntConfigUseCase.prototype, 'execute')
      .mockResolvedValue({ ...OUT, draft: { ...OUT.draft, secret: 'SSID-X' } } as never);
    const res = await post({ provider: 'MERCADO_LIVRE', intent: 'moda feminina barata' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: OUT });
    expect(res.body).not.toContain('SSID-X');
    expect(exec.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-a', provider: 'MERCADO_LIVRE', intent: 'moda feminina barata', pickProduct: false });
  });

  it('400: marca fora da lista, intenção > 120', async () => {
    const exec = vi.spyOn(SuggestHuntConfigUseCase.prototype, 'execute');
    for (const body of [{ provider: 'AMAZON' }, { provider: 'SHEIN', intent: 'a'.repeat(121) }, {}]) {
      expect((await post(body)).statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it('403 fora da audiência, sem chamar o use case', async () => {
    auth.isSuperAdmin = false;
    const exec = vi.spyOn(SuggestHuntConfigUseCase.prototype, 'execute');
    const res = await post({ provider: 'SHEIN', pickProduct: true });
    expect(res.statusCode).toBe(403);
    expect(exec).not.toHaveBeenCalled();
  });

  it('429 do teto diário com código próprio', async () => {
    vi.spyOn(SuggestHuntConfigUseCase.prototype, 'execute').mockRejectedValue(new OfferHuntAiSuggestDailyLimitError(5));
    const res = await post({ provider: 'SHEIN', pickProduct: true, intent: null });
    expect(res.statusCode).toBe(429);
    expect(JSON.stringify(res.json())).toContain('OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT');
  });
});
