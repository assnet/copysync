import type { IProductAccessReader } from '../../domain/contracts/IProductAccessReader';
import type { ProductKey } from '../../domain/services/resolveProductAccess';
import { logger } from '../../../../shared/logger/logger';

/**
 * Leitor do segundo plano e das páginas públicas (design §3.5): falha de leitura = liberado + `warn`,
 * como o gate do chat. Fila, listener ou página não param por banco lento; a rota HTTP segue com o
 * gate (que em `enforce` responde 503). Nunca usar no gate HTTP.
 */
export class FailOpenProductAccessReader implements IProductAccessReader {
  constructor(private readonly inner: IProductAccessReader) {}

  async has(tenantId: string, product: ProductKey): Promise<boolean> {
    try {
      return await this.inner.has(tenantId, product);
    } catch (err) {
      logger.warn({ err: (err as Error)?.message, tenantId, product }, 'background product access read failed; allowing');
      return true;
    }
  }

  list(tenantId: string): Promise<ProductKey[]> {
    return this.inner.list(tenantId);
  }

  invalidate(tenantId: string): void {
    this.inner.invalidate(tenantId);
  }
}
