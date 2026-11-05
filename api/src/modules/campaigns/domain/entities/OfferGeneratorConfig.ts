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
  /** Horário de postagem (`postingWindow`): faixa 0..1440 no fuso da plataforma; 0–1440 = dia inteiro. */
  windowStartMinute: number;
  windowEndMinute: number;
  /** Bit 0 = domingo … bit 6 = sábado; 127 = todos. */
  weekdaysMask: number;
  updatedAt: Date;
}

/** Sessão vista pelo gerador: só o que a validação e o envio precisam. */
export interface OfferSessionRef {
  id: string;
  status: string;
  /** Engine da sessão (`baileys` | `telegram`): define o canal do limite do plano. */
  engine: string;
}
