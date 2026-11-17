import type { ProductKey } from '../services/resolveProductAccess';

/** Leitura do acesso por produto do tenant (regra em `resolveProductAccess`). Falha de leitura lança. */
export interface IProductAccessReader {
  has(tenantId: string, product: ProductKey): Promise<boolean>;
  list(tenantId: string): Promise<ProductKey[]>;
  /** Descarta o cache do tenant neste processo (após gravar linha de produto). */
  invalidate(tenantId: string): void;
}
