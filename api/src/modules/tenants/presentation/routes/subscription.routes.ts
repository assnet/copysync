import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantAnyStatusHook } from '../../../../shared/http/hooks/tenantAnyStatusHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { prisma } from '../../../../shared/database/prisma.client';
import { GetTenantSubscriptionUseCase } from '../../application/use-cases/GetTenantSubscriptionUseCase';
import { PrismaTenantRepository } from '../../infrastructure/repositories/PrismaTenantRepository';
import { PrismaEntitlementReader } from '../../infrastructure/repositories/PrismaEntitlementReader';
import { PrismaTenantUsageReader } from '../../infrastructure/repositories/PrismaTenantUsageReader';
import { SubscriptionPresenter } from '../presenters/SubscriptionPresenter';
import { createTenantProductRepository } from '../../infrastructure/productAccessContainer';
import { FeatureAudienceGate } from '../../application/services/FeatureAudienceGate';
import { featureAudienceReader } from '../../infrastructure/featureAudience';

const getSubscription = new GetTenantSubscriptionUseCase(
  new PrismaTenantRepository(),
  new PrismaEntitlementReader(prisma),
  new PrismaTenantUsageReader(prisma),
  createTenantProductRepository(),
  new FeatureAudienceGate(featureAudienceReader()),
);

const nullableString = { type: ['string', 'null'] } as const;
const nullableInt = { type: ['integer', 'null'] } as const;

const subscriptionResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        tenantName: { type: 'string' },
        planSlug: { type: ['string', 'null'], enum: ['lite', 'pro', 'max', null] },
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED'] },
        suspendedAt: { ...nullableString, format: 'date-time' },
        expiresAt: { ...nullableString, format: 'date-time' },
        limits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              channel: { type: ['string', 'null'], enum: ['whatsapp', 'telegram', null] },
              kind: { type: 'string', enum: ['count', 'daily', 'feature'] },
              used: nullableInt,
              limit: nullableInt,
              enabled: { type: 'boolean' },
              /** Produto dono da chave; `null` = recurso do tenant (sessões). */
              product: { type: ['string', 'null'] },
            },
          },
        },
        /** Um item por produto com acesso (docs/acesso-por-produto.md); o topo segue sendo Afiliados. */
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              planSlug: nullableString,
              tier: { type: ['string', 'null'], enum: ['lite', 'pro', 'max', null] },
              expiresAt: { ...nullableString, format: 'date-time' },
              source: { type: ['string', 'null'], enum: ['BILLING', 'ADMIN', null] },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Tela "Assinatura" (`/subscription`). Usa `tenantAnyStatusHook`: tenant SUSPENDED/CANCELLED lê o
 * próprio plano e o motivo (SUB-02); não-membro segue 403. Só leitura; não reusar o hook em outra rota.
 */
export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      preHandler: [authHook, tenantAnyStatusHook],
      schema: {
        tags: ['Tenants'],
        summary: 'Assinatura do tenant',
        description: 'Plano, status, vencimento e uso × limite de cada entitlement. Acessível com tenant suspenso.',
        security: [{ bearerAuth: [] }],
        response: {
          200: subscriptionResponse,
          401: { $ref: 'ErrorResponse#' },
          403: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const out = await getSubscription.execute(request.tenantContext.tenantId, { isSuperAdmin: request.tenantContext.isSuperAdmin });
      httpResponse.ok(reply, SubscriptionPresenter.toResponse(out));
    },
  );
}
