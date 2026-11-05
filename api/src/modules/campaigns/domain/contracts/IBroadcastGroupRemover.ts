/** Resultado da remoção: `found` = a conversa de grupo existe no tenant; `removed` = usos apagados. */
export interface RemoveBroadcastGroupResult {
  found: boolean;
  removed: number;
}

/**
 * Tira um grupo de disparo de todos os usos do tenant (BG-05): destinos do gerador
 * (`offer_destinations`) e de todos os monitoramentos (`broadcast_groups`), numa transação.
 * Toda consulta filtra `tenantId`. Envios já enfileirados seguem as regras da fila.
 */
export interface IBroadcastGroupRemover {
  removeEverywhere(tenantId: string, conversationId: string): Promise<RemoveBroadcastGroupResult>;
}
