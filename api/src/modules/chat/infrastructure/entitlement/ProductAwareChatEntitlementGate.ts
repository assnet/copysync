import type { IProductAccessReader } from '../../../tenants/domain/contracts/IProductAccessReader';
import type { IChatEntitlementGate } from '../../domain/contracts/IChatEntitlementGate';

/**
 * Chat ligado só com o produto `CHAT` (acompanha Afiliados) e, se houver, o gate de `chat_enabled`
 * (design product-access §3.5). Produto inativo = mesmo efeito do chat desligado: ingestão só do contato,
 * listeners de estado não gravam nem publicam. Composto só em `enforce`.
 */
export class ProductAwareChatEntitlementGate implements IChatEntitlementGate {
  constructor(
    private readonly products: Pick<IProductAccessReader, 'has'>,
    private readonly inner?: IChatEntitlementGate,
  ) {}

  async isChatEnabled(tenantId: string): Promise<boolean> {
    if (!(await this.products.has(tenantId, 'CHAT'))) return false;
    return this.inner ? this.inner.isChatEnabled(tenantId) : true;
  }
}
