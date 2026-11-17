import type { IProductAccessReader } from '../../domain/contracts/IProductAccessReader';
import type { ProductKey } from '../../domain/services/resolveProductAccess';

export type WithProducts<T> = T & { products: ProductKey[] };

/**
 * Acrescenta `products` (produtos com acesso) a cada vínculo de tenant. Uma leitura por tenant, sempre pelo
 * leitor com cache (sem N+1 fora dele). Falha de leitura sobe para quem chamou.
 */
export async function attachTenantProducts<T extends { tenantId: string }>(
  memberships: readonly T[],
  reader: Pick<IProductAccessReader, 'list'>,
): Promise<WithProducts<T>[]> {
  return Promise.all(memberships.map(async (m) => ({ ...m, products: await reader.list(m.tenantId) })));
}
