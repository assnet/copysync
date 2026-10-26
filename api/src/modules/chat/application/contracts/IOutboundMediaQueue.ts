/**
 * Trabalho de envio de uma mídia já gravada como `PENDING`. Leva só identificadores: o despacho
 * relê a mensagem no banco, então o job é pequeno e um retry nunca usa dado velho.
 */
export interface OutboundMediaJob {
  messageId: string;
  tenantId: string;
  sessionId: string;
  conversationId: string;
  /**
   * Telefones a mencionar (ex.: oferta com "marcar todos"). Exceção ao "só ids": `ChatMessage`
   * não guarda menções, então elas viajam só no job em memória. Retry
   * (`RetryOutboundMediaUseCase`) e recuperação de PENDING no boot reenviam SEM menção —
   * degradação aceita: a mídia chega, só não marca ninguém.
   */
  mentions?: string[];
}

/**
 * Porta da fila de envio de mídia. Existe para o use case não conhecer a implementação (hoje em
 * memória, no processo): ele só enfileira e reage à recusa; limites e agendamento ficam na infra.
 */
export interface IOutboundMediaQueue {
  /**
   * Enfileira o job. Serial por conversa (mantém a ordem do lote), com concorrência limitada por
   * sessão e global. Devolve `false` quando a fila da sessão está cheia ou em `drain`: o chamador
   * marca a mensagem como `FAILED`. Nunca lança por recusa.
   */
  enqueue(job: OutboundMediaJob): boolean;

  /** Ids das mensagens na fila ou em envio agora; a varredura de órfãs não deve tocá-las. */
  inFlightIds(): string[];

  /**
   * Shutdown: passa a recusar novos jobs e espera os em andamento até `timeoutMs`. Não rejeita
   * ao estourar o prazo; o que ficar `PENDING` é resolvido pela recuperação do próximo boot.
   */
  drain(timeoutMs: number): Promise<void>;
}
