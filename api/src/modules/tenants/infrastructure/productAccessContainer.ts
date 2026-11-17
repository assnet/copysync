import { env } from '../../../shared/config/env';
import { prisma } from '../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../shared/database/UnitOfWork';
import type { IProductAccessReader } from '../domain/contracts/IProductAccessReader';
import type { ITenantProductRepository } from '../domain/contracts/ITenantProductRepository';
import { AlwaysGrantedProductAccessReader } from './access/AlwaysGrantedProductAccessReader';
import { CachedProductAccessReader } from './access/CachedProductAccessReader';
import { FailOpenProductAccessReader } from './access/FailOpenProductAccessReader';
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

type GateMode = typeof env.PRODUCT_ACCESS_GATE_MODE;

/** Segundo plano e páginas públicas só filtram em `enforce` (design §3.5). */
export function backgroundProductAccessEnforced(mode: GateMode = env.PRODUCT_ACCESS_GATE_MODE): boolean {
  return mode === 'enforce';
}

/**
 * Leitor do segundo plano e das páginas públicas: fora de `enforce` é o `AlwaysGranted` (não consulta);
 * em `enforce`, o leitor com cache com falha de leitura = liberado.
 */
export function backgroundProductAccessReader(mode: GateMode = env.PRODUCT_ACCESS_GATE_MODE): IProductAccessReader {
  if (!backgroundProductAccessEnforced(mode)) return new AlwaysGrantedProductAccessReader();
  return new FailOpenProductAccessReader(productAccessReader());
}

/** Repositório fora de transação, ou dentro do `tx` de quem chama (webhook, admin). */
export function createTenantProductRepository(tx?: TransactionClient): ITenantProductRepository {
  return new PrismaTenantProductRepository(tx ?? prisma);
}
