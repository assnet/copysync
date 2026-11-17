import type { FastifyInstance } from 'fastify';
import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { SetTenantProductUseCase } from '../../application/use-cases/SetTenantProductUseCase';
import type { TenantProductStatus } from '../../domain/services/resolveProductAccess';
import { productAccessReader } from '../../infrastructure/productAccessContainer';
import { prismaTenantProductTransaction } from '../../infrastructure/tenantProductTransaction';

const preHandler = [authHook, superAdminHook];
const tags = ['Tenant products (admin)'];
const log = logger.child({ module: 'tenantProductAdmin' });

let setUc: SetTenantProductUseCase | null = null;
const set = () => (setUc ??= new SetTenantProductUseCase({
  transaction: prismaTenantProductTransaction,
  reader: productAccessReader(),
  gateMode: () => env.PRODUCT_ACCESS_GATE_MODE,
  warn: (meta, msg) => log.error(meta, msg),
}));

const params = {
  type: 'object',
  required: ['tenantId', 'product'],
  properties: { tenantId: { type: 'string', minLength: 1, maxLength: 64 }, product: { type: 'string', minLength: 1, maxLength: 32 } },
} as const;

const body = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    planSlug: { type: ['string', 'null'], maxLength: 64 },
  },
} as const;

const response = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        product: { type: 'string' },
        status: { type: 'string' },
        planSlug: { type: ['string', 'null'] },
        source: { type: 'string' },
      },
    },
  },
} as const;

/**
 * Super admin: concessão manual de produto ao tenant (docs/acesso-por-produto.md). Registrado em
 * `/api/admin/tenants` ao lado de `marketplaceRiskAdminRoutes` (caminhos distintos: `/:tenantId/products/:product`).
 */
export async function tenantProductAdminRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { tenantId: string; product: string }; Body: { status: TenantProductStatus; planSlug?: string | null } }>(
    '/:tenantId/products/:product',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Liga ou desliga um produto do tenant (source=ADMIN): linha, preset do plano e merge das chaves compartilhadas, auditado',
        params,
        body,
        response: { 200: response, 400: { $ref: 'ErrorResponse#' }, 401: { $ref: 'ErrorResponse#' }, 404: { $ref: 'ErrorResponse#' } },
      },
    },
    async (request, reply) => {
      const out = await set().execute({
        tenantId: request.params.tenantId,
        product: request.params.product,
        status: request.body.status,
        planSlug: request.body.planSlug ?? null,
        actorUserId: request.user.userId,
      });
      return reply.status(200).send({ success: true, data: out });
    },
  );
}
