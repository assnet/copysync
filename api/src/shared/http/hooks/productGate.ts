import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IProductAccessReader } from '../../../modules/tenants/domain/contracts/IProductAccessReader';
import { isLegacyProduct, type ProductKey } from '../../../modules/tenants/domain/services/resolveProductAccess';
import { ProductAccessCheckUnavailableError, ProductUnavailableError } from '../../errors/internal/PlanErrors';
import { logger } from '../../logger/logger';

export type ProductGateMode = 'off' | 'log' | 'enforce';

export type ProductGate = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * preHandler do acesso por produto (docs/acesso-por-produto.md). Roda depois do `tenantHook`; lança
 * `AppError` (nunca `send` + `return;`).
 *
 * - Sem `tenantContext` (rota pública do plugin) ou super admin: passa.
 * - Produto legado: `off` não consulta; `log` consulta e só registra `would_block`; `enforce` → 403.
 * - Produto novo: sempre exigido, em qualquer modo.
 * - Leitura falhou: produto novo → 503 genérico (nunca libera); legado segue em qualquer modo, com log `error`
 *   (legado sem linha é ativo por regra: pico de banco não pode derrubar Afiliados/Chat de todo tenant).
 */
export function createProductGate(product: ProductKey, reader: IProductAccessReader, mode: ProductGateMode): ProductGate {
  const legacy = isLegacyProduct(product);
  return async function productGate(request: FastifyRequest): Promise<void> {
    const ctx = request.tenantContext;
    if (!ctx?.tenantId || ctx.isSuperAdmin) return;
    if (legacy && mode === 'off') return;
    const required = !legacy || mode === 'enforce';

    let allowed: boolean;
    try {
      allowed = await reader.has(ctx.tenantId, product);
    } catch (err) {
      logger.error({ err: (err as Error)?.message, tenantId: ctx.tenantId, product }, 'product access read failed');
      if (!legacy) throw new ProductAccessCheckUnavailableError();
      return;
    }
    if (allowed) return;
    if (required) throw new ProductUnavailableError(product);
    logger.warn({ tenantId: ctx.tenantId, product, route: request.routeOptions?.url }, 'product access would_block');
  };
}
