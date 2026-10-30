import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { perTenantRateLimit, rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { offerStoryContainer } from '../../infrastructure/offerStoryContainer';
import type { RenderOfferStoryInput } from '../../application/use-cases/RenderOfferStoryUseCase';
import {
  offerStoryTemplatesResponse,
  renderOfferStoryBodySchema,
  renderOfferStoryResponse,
} from '../schemas/offerStory.schema';

// Array novo por rota: o rate limit anexa o próprio hook ao fim do `preHandler` (depois do tenant).
const preHandler = () => [authHook, tenantHook];
const tags = ['OfferStory'];
const uc = () => offerStoryContainer.useCases();

type RenderBody = Omit<RenderOfferStoryInput, 'tenantId'>;

/**
 * Story de Oferta do tenant (.specs/features/offer-story/design.md). Registrada em `/api/offer-story`.
 * Gate do plano nos use cases: 403 PLAN_FEATURE_UNAVAILABLE (painel redireciona para /plans).
 * Gerar arte tem limite por tenant (429 RATE_LIMITED, `meta.retryAfterSeconds`).
 */
export async function offerStoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates', {
    preHandler: preHandler(),
    schema: { tags, summary: 'Catálogo de templates do story (ordem da grade)', response: { 200: offerStoryTemplatesResponse } },
  }, async (request, reply) => {
    const out = await uc().listTemplates.execute({ tenantId: request.tenantContext.tenantId });
    httpResponse.ok(reply, out);
  });

  app.post<{ Body: RenderBody }>('/render', {
    preHandler: preHandler(),
    config: { rateLimit: perTenantRateLimit(rateLimitPresets.offerStoryRender) },
    schema: {
      tags,
      summary: 'Gerar a arte 1080×1920 (JPEG em data URL) a partir do link do produto',
      body: renderOfferStoryBodySchema,
      response: { 200: renderOfferStoryResponse },
    },
  }, async (request, reply) => {
    const out = await uc().render.execute({ ...request.body, tenantId: request.tenantContext.tenantId });
    httpResponse.ok(reply, out);
  });
}
