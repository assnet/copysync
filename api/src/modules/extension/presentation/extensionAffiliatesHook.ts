import type { FastifyRequest } from 'fastify';
import type { IProductAccessReader } from '../../tenants/domain/contracts/IProductAccessReader';
import { backgroundProductAccessReader } from '../../tenants/infrastructure/productAccessContainer';
import { ProductUnavailableError } from '../../../shared/errors/internal/PlanErrors';

/**
 * Rotas de sincronização da extensão (cookie, sem `tenantContext`, fora do gate de `withProduct`): tenant
 * da extensão (`mlTenantId`) com Afiliados inativo → 403 `PRODUCT_UNAVAILABLE` (design product-access §3.5).
 * Vai logo depois do `extensionAuthHook`. Fora de `enforce` o leitor não consulta.
 */
export function createExtensionAffiliatesHook(reader: Pick<IProductAccessReader, 'has'>) {
  return async function extensionAffiliatesHook(request: FastifyRequest): Promise<void> {
    const tenantId = request.extensionSession?.mlTenantId;
    if (!tenantId) return;
    if (!(await reader.has(tenantId, 'AFFILIATES'))) throw new ProductUnavailableError('AFFILIATES');
  };
}

let hook: ReturnType<typeof createExtensionAffiliatesHook> | null = null;

/** Hook com o leitor do modo atual, criado no primeiro uso. */
export async function extensionAffiliatesHook(request: FastifyRequest): Promise<void> {
  hook ??= createExtensionAffiliatesHook(backgroundProductAccessReader());
  return hook(request);
}
