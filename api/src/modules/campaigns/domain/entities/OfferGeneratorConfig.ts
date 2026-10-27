export type OfferDispatchOrder = 'SEQUENTIAL' | 'INTERLEAVED';
export const OFFER_DISPATCH_ORDERS: readonly OfferDispatchOrder[] = ['SEQUENTIAL', 'INTERLEAVED'];

/**
 * Configuração do gerador por tenant: sessões que enviam (na ordem), intervalo entre dois
 * envios consecutivos (segundos, vale dentro e entre sessões) e ordem com várias sessões.
 */
export interface OfferGeneratorConfig {
  tenantId: string;
  /** Vazio = nunca escolhida ou todas apagadas. */
  sessionIds: string[];
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
  updatedAt: Date;
}

/** Sessão vista pelo gerador: só o que a validação e o envio precisam. */
export interface OfferSessionRef {
  id: string;
  status: string;
}
