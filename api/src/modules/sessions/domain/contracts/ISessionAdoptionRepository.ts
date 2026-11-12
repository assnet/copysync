/**
 * Adoção por capacidade (ADOPT-03/04/05, docs/arquitetura-escala.md §3.2). Relógio sempre o do
 * banco. Operação de plataforma (o worker adota de qualquer tenant `ACTIVE`): cada linha devolvida
 * carrega `tenantId` para o chamador seguir no contexto do tenant certo (auditoria, reconexão).
 */
export interface AdoptedSessionRef {
  id: string;
  tenantId: string;
}

export interface ISessionAdoptionRepository {
  /**
   * Adota uma sessão órfã (uma por chamada, `FOR UPDATE SKIP LOCKED`): grava lease deste worker e,
   * na mesma escrita, conta a tentativa (`adoptFailures+1`) e o próximo backoff (D1). `null` = nada a adotar.
   * `shard` `null` só adota sessões sem shard.
   */
  adoptNext(workerId: string, shard: string | null, ttlMs: number): Promise<AdoptedSessionRef | null>;
  /**
   * Adoção que não abriu por lease negado/teto (não é falha da sessão): solta o lease gravado por
   * `adoptNext` e desfaz o `+1` e o backoff, só se este worker ainda for o dono.
   */
  revertAdoptAttempt(sessionId: string, workerId: string): Promise<void>;
  /** Esgotadas (tentativas no teto, sem lease vivo, pedido vivo) viram `FAILED` sem pedido (ADOPT-05). */
  failExhausted(): Promise<AdoptedSessionRef[]>;
  /** Zera contador e backoff (ADOPT-04); não escreve quando já estão zerados. */
  resetFailures(sessionId: string): Promise<void>;
  /**
   * Sessões com pedido vivo sem dono vivo (tenant `ACTIVE`); `olderThanMs` filtra pedido mais antigo que isso.
   * `statementTimeoutMs` (opcional) põe teto na consulta (falha em vez de esperar); sem ele, sem teto.
   */
  countAwaitingCapacity(olderThanMs?: number, options?: CountAwaitingOptions): Promise<number>;
}

export interface CountAwaitingOptions {
  /** Teto da consulta em ms (`SET LOCAL statement_timeout` numa transação). */
  statementTimeoutMs?: number;
  /**
   * Só pedidos feitos depois deste instante (`connectRequestedAt > requestedAfter`, comparado em UTC).
   * O automático passa o início do último intervalo: quem pediu antes da subida aguarda o boot da réplica nova.
   */
  requestedAfter?: Date | null;
}
