import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { perTenantRateLimit, rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import type { HuntProvider } from '../../domain/hunter/HuntProvider';
import { offerHuntAiContainer } from '../../infrastructure/offerHuntAiContainer';
import { offerHunterAudienceHook } from '../hooks/offerHunterAudienceHook';
import { OfferHuntAiSuggestPresenter as P } from '../presenters/OfferHuntAiSuggestPresenter';
import { aiSuggestBodySchema, aiSuggestResponse } from '../schemas/offerHuntAiSuggest.schema';

type Body = { Body: { provider: HuntProvider; intent?: string | null; pickProduct?: boolean } };

/**
 * IA que configura a caçada, em /api/offer-hunts/ai-suggest (AI-01..06). Mesmos hooks do caçador (auth, tenant,
 * audiência) + rate limit leve. Nada é salvo: devolve o rascunho para o usuário conferir. Conta no teto técnico
 * de 5/dia e em `ai_requests_per_day`.
 */
export async function offerHuntAiSuggestRoutes(app: FastifyInstance): Promise<void> {
  app.post<Body>(
    '/ai-suggest',
    {
      preHandler: [authHook, tenantHook, offerHunterAudienceHook],
      config: { rateLimit: perTenantRateLimit(rateLimitPresets.offerHuntRun) },
      schema: {
        tags: ['Offer Hunter'],
        summary: 'IA sugere a configuração da caçada (rascunho, nada é salvo; 5/dia por conta)',
        body: aiSuggestBodySchema,
        response: { 200: aiSuggestResponse },
      },
    },
    async (request, reply) => {
      const out = await offerHuntAiContainer.suggestHuntConfig().execute({
        tenantId: request.tenantContext.tenantId,
        provider: request.body.provider,
        intent: request.body.intent ?? null,
        pickProduct: request.body.pickProduct === true,
        now: new Date(),
      });
      httpResponse.ok(reply, P.suggestion(out));
    },
  );
}
