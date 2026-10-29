import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { perTenantRateLimit, rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { storefrontContainer } from '../../infrastructure/storefrontContainer';
import type { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import type { StorefrontPageImageKind } from '../../application/use-cases/SetStorefrontImageUseCase';
import type { SaveStorefrontDTO } from '../../application/use-cases/SaveStorefrontUseCase';
import type { PreviewStorefrontDraft } from '../../application/use-cases/PreviewStorefrontUseCase';
import type { UpdateStorefrontOfferInput } from '../../domain/contracts/IStorefrontOfferRepository';
import { StorefrontPresenter } from '../presenters/StorefrontPresenter';
import {
  extractOfferBodySchema,
  imageKindParamSchema,
  imageResponse,
  offerIdParamSchema,
  offerResponse,
  offerStatusBodySchema,
  previewBodySchema,
  previewResponse,
  reorderOffersBodySchema,
  saveStorefrontBodySchema,
  setImageBodySchema,
  slugAvailabilityQuerySchema,
  slugAvailabilityResponse,
  storefrontOverviewResponse,
  storefrontResponse,
  updateOfferBodySchema,
} from '../schemas/storefront.schema';

// Array novo por rota: o rate limit anexa o próprio hook ao fim do `preHandler` (depois do tenant).
const preHandler = () => [authHook, tenantHook];
const tags = ['Storefront'];
const uc = () => storefrontContainer.useCases();

type IdParams = { Params: { id: string } };
type KindParams = { Params: { kind: StorefrontPageImageKind } };
type SaveBody = Omit<SaveStorefrontDTO, 'tenantId'>;
type PreviewBody = PreviewStorefrontDraft & { viewport?: 'mobile' | 'desktop' };

/**
 * Página de Ofertas do tenant (design.md §4.7). Registrada em `/api/storefront`.
 * Gate do plano nos use cases: 403 PLAN_FEATURE_UNAVAILABLE (painel redireciona para /plans).
 * Checar nome, prévia e extração têm limite por tenant (429 RATE_LIMITED, `meta.retryAfterSeconds`).
 */
export async function storefrontRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler: preHandler(),
    schema: { tags, summary: 'Página, ofertas, endereço, catálogo de categorias e domínios', response: { 200: storefrontOverviewResponse } },
  }, async (request, reply) => {
    const out = await uc().get.execute(request.tenantContext.tenantId);
    httpResponse.ok(reply, StorefrontPresenter.overview(out));
  });

  app.get<{ Querystring: { slug: string; domainId?: string } }>('/slug-availability', {
    preHandler: preHandler(),
    config: { rateLimit: perTenantRateLimit(rateLimitPresets.storefrontSlug) },
    schema: {
      tags,
      summary: 'Disponibilidade do nome do endereço (namespace compartilhado com o rodízio)',
      querystring: slugAvailabilityQuerySchema,
      response: { 200: slugAvailabilityResponse },
    },
  }, async (request, reply) => {
    const out = await uc().checkSlug.execute({ ...request.query, tenantId: request.tenantContext.tenantId });
    httpResponse.ok(reply, out);
  });

  app.put<{ Body: SaveBody }>('/', {
    preHandler: preHandler(),
    schema: { tags, summary: 'Criar ou atualizar a página (troca de nome move o endereço)', body: saveStorefrontBodySchema, response: { 200: storefrontResponse } },
  }, async (request, reply) => {
    const page = await uc().save.execute({ ...request.body, tenantId: request.tenantContext.tenantId });
    httpResponse.ok(reply, StorefrontPresenter.storefront(page));
  });

  app.put<KindParams & { Body: { uploadId: string } }>('/images/:kind', {
    preHandler: preHandler(),
    schema: {
      tags,
      summary: 'Foto ou capa a partir de um upload concluído',
      params: imageKindParamSchema,
      body: setImageBodySchema,
      response: { 200: imageResponse },
    },
  }, async (request, reply) => {
    const { tenantId, userId } = request.tenantContext;
    const out = await uc().setImage.execute({ tenantId, userId, kind: request.params.kind, uploadId: request.body.uploadId });
    httpResponse.ok(reply, out);
  });

  app.delete<KindParams>('/images/:kind', {
    preHandler: preHandler(),
    schema: { tags, summary: 'Remover foto ou capa', params: imageKindParamSchema },
  }, async (request, reply) => {
    await uc().removeImage.execute({ tenantId: request.tenantContext.tenantId, kind: request.params.kind });
    httpResponse.noContent(reply);
  });

  // JSON `{ data: { html } }`: o painel põe em `<iframe sandbox srcdoc>` via Axios (envelope padrão).
  app.post<{ Body: PreviewBody }>('/preview', {
    preHandler: preHandler(),
    config: { rateLimit: perTenantRateLimit(rateLimitPresets.storefrontPreview) },
    schema: { tags, summary: 'Prévia do rascunho (HTML)', body: previewBodySchema, response: { 200: previewResponse } },
  }, async (request, reply) => {
    const { viewport = 'mobile', ...draft } = request.body;
    const out = await uc().preview.execute({ tenantId: request.tenantContext.tenantId, draft, viewport });
    httpResponse.ok(reply, out);
  });

  app.post<{ Body: { url: string; category?: string | null } }>('/offers', {
    preHandler: preHandler(),
    config: { rateLimit: perTenantRateLimit(rateLimitPresets.storefrontExtract) },
    schema: { tags, summary: 'Extrair oferta de um link (entra como rascunho)', body: extractOfferBodySchema, response: { 201: offerResponse } },
  }, async (request, reply) => {
    const offer = await uc().extractOffer.execute({ ...request.body, tenantId: request.tenantContext.tenantId });
    httpResponse.created(reply, StorefrontPresenter.offer(offer));
  });

  app.put<{ Body: { status: StorefrontOfferStatus; ids: string[] } }>('/offers/order', {
    preHandler: preHandler(),
    schema: { tags, summary: 'Reordenar uma aba (lista completa na nova ordem)', body: reorderOffersBodySchema },
  }, async (request, reply) => {
    await uc().reorderOffers.execute({ ...request.body, tenantId: request.tenantContext.tenantId });
    httpResponse.noContent(reply);
  });

  app.patch<IdParams & { Body: UpdateStorefrontOfferInput }>('/offers/:id', {
    preHandler: preHandler(),
    schema: {
      tags,
      summary: 'Editar título, preços ou categoria',
      params: offerIdParamSchema,
      body: updateOfferBodySchema,
      response: { 200: offerResponse },
    },
  }, async (request, reply) => {
    const offer = await uc().updateOffer.execute({ ...request.body, tenantId: request.tenantContext.tenantId, id: request.params.id });
    httpResponse.ok(reply, StorefrontPresenter.offer(offer));
  });

  app.post<IdParams & { Body: { status: StorefrontOfferStatus } }>('/offers/:id/status', {
    preHandler: preHandler(),
    schema: {
      tags,
      summary: 'Publicar ou voltar para rascunho (vai para o fim da aba)',
      params: offerIdParamSchema,
      body: offerStatusBodySchema,
      response: { 200: offerResponse },
    },
  }, async (request, reply) => {
    const offer = await uc().setOfferStatus.execute({
      tenantId: request.tenantContext.tenantId,
      id: request.params.id,
      status: request.body.status,
    });
    httpResponse.ok(reply, StorefrontPresenter.offer(offer));
  });

  app.delete<IdParams>('/offers/:id', {
    preHandler: preHandler(),
    schema: { tags, summary: 'Apagar oferta (e a imagem)', params: offerIdParamSchema },
  }, async (request, reply) => {
    await uc().deleteOffer.execute({ tenantId: request.tenantContext.tenantId, id: request.params.id });
    httpResponse.noContent(reply);
  });
}
