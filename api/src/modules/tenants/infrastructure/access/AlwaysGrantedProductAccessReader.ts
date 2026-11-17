import type { IProductAccessReader } from '../../domain/contracts/IProductAccessReader';
import { PRODUCTS, type ProductKey } from '../../domain/services/resolveProductAccess';

/** Leitor "tudo liberado" para testes e composições sem banco. Nunca usar como fallback de falha. */
export class AlwaysGrantedProductAccessReader implements IProductAccessReader {
  async has(): Promise<boolean> {
    return true;
  }

  async list(): Promise<ProductKey[]> {
    return [...PRODUCTS];
  }

  invalidate(): void {}
}
