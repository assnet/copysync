/**
 * Vaga de envio de reação já reservada. Opaca para quem usa: só serve para devolver
 * a vaga com `release` quando o envio falha.
 */
export interface ReactionSendReservation {
  readonly sessionId: string;
  readonly messageId: string;
}

/**
 * Limite de envio de reações pelo painel (design de reações, §7 passo 5): intervalo mínimo
 * por mensagem e teto por sessão por minuto.
 *
 * Contrato:
 * - `tryAcquire` é **síncrono** e reserva a vaga na própria checagem — registrar só depois do
 *   envio deixaria duas requisições simultâneas passarem juntas. `null` = limite estourado
 * - `release` devolve a vaga nos dois limites; idempotente (chamar duas vezes não devolve duas)
 */
export interface IReactionSendThrottle {
  tryAcquire(sessionId: string, messageId: string): ReactionSendReservation | null;
  release(reservation: ReactionSendReservation): void;
}
