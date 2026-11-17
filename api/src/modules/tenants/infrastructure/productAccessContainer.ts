import { prisma } from '../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import type { IProductAccessReader } from '../domain/contracts/IProductAccessReader';
import type { ITenantProductRepository } from '../domain/contracts/ITenantProductRepository';
import { CachedProductAccessReader } from './access/CachedProductAccessReader';
import { PrismaTenantProductRepository } from './repositories/PrismaTenantProductRepository';

/**
 * Composição do acesso por produto (docs/acesso-por-produto.md). Um leitor com cache por processo,
 * criado no primeiro uso; rotas e hooks não importam `prisma`.
 */
let reader: CachedProductAccessReader | null = null;

export function productAccessReader(): IProductAccessReader {
  reader ??= new CachedProductAccessReader(new PrismaTenantProductRepository(prisma));
  return reader;
}

/** Repositório fora de transação, ou dentro do `tx` de quem chama (webhook, admin). */
export function createTenantProductRepository(tx?: TransactionClient): ITenantProductRepository {
  return new PrismaTenantProductRepository(tx ?? prisma);
}
