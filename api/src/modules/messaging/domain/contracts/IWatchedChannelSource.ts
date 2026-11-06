/**
 * Canais/supergrupos que uma sessão precisa acompanhar ativamente (monitoramento ligado).
 *
 * Existe porque o Telegram não garante empurrar post de canal para conta de usuário: a engine
 * consulta só estes, nunca todos os dialogs da conta. Ver docs/sessoes-telegram.md §"Recuperação de canal".
 */
export interface IWatchedChannelSource {
  /** Peer ids marcados (`-100…`), no máximo `limit`. Lista vazia = nada a consultar. */
  listWatchedChannels(tenantId: string, sessionId: string, limit: number): Promise<string[]>;
}
