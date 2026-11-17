import type { ProductKey, TenantProductStatus } from '../services/resolveProductAccess';

export type TenantProductSource = 'BILLING' | 'ADMIN';

/** Linha de `tenant_products` (docs/acesso-por-produto.md). Sem linha: legado ativo, novo inativo. */
export interface TenantProduct {
  tenantId: string;
  product: ProductKey;
  status: TenantProductStatus;
  planSlug: string | null;
  expiresAt: Date | null;
  source: TenantProductSource;
  inactiveSince: Date | null;
  updatedAt: Date;
}

export interface UpsertTenantProductInput {
  tenantId: string;
  product: ProductKey;
  status: TenantProductStatus;
  planSlug: string | null;
  expiresAt: Date | null;
  source: TenantProductSource;
}

/** Toda consulta é por `tenantId`. Implementação aceita cliente de transação (webhook grava no próprio `tx`). */
export interface ITenantProductRepository {
  find(tenantId: string, product: ProductKey): Promise<TenantProduct | null>;
  findAll(tenantId: string): Promise<TenantProduct[]>;
  /**
   * Cria ou atualiza a linha (único por tenant+produto). `inactiveSince`: preenchido ao virar
   * `INACTIVE` (mantido se já estava inativa), limpo ao voltar a `ACTIVE`.
   */
  upsert(input: UpsertTenantProductInput): Promise<TenantProduct>;
}
