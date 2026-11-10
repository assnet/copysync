/** Mensagem recebida cuja mídia a engine pode baixar (antes do bus). */
export interface IncomingMediaContext {
  tenantId: string;
  sessionId: string;
  isGroup: boolean;
  /** Id do grupo no formato do evento (`groupJid` do MESSAGE_RECEIVED). */
  groupJid?: string | null;
  /** Tipo da mensagem (`IMAGE`, `VIDEO`…) ou `LINK_PREVIEW` para as miniaturas da prévia. */
  msgType: string;
  /** Enviada por nós (outro aparelho ou eco não marcado). */
  fromMe?: boolean;
  /**
   * `live` = `notify` (vira MESSAGE_RECEIVED); `history` = `append`/sincronização (só vai para o
   * histórico do chat). Ausente = `live`.
   */
  origin?: 'live' | 'history';
}

/**
 * Decide se a engine baixa a mídia recebida. `currentRule` é a regra da própria engine (contato
 * sempre, grupo por `autoDownloadMedia`) e só é chamada quando a política a adota.
 */
export interface IIncomingMediaPolicy {
  shouldDownload(ctx: IncomingMediaContext, currentRule: () => Promise<boolean>): Promise<boolean>;
}

/** Sem política injetada: regra atual da engine, sem consulta extra. */
export const CURRENT_RULE_MEDIA_POLICY: IIncomingMediaPolicy = {
  shouldDownload: (_ctx, currentRule) => currentRule(),
};
