/** Sessão vista pelo Saver: só o que a escolha de grupos precisa. */
export interface SaverSessionRef {
  id: string;
  /** Status de conexão (mesmos valores de `SessionStatus`). */
  status: string;
  /** `Session.engine` (`baileys`, `telegram`…). */
  engine: string;
}

/** Sessões do tenant (sem `deletedAt`). Contrato próprio: nada importado do módulo `sessions`. */
export interface ISaverSessionReader {
  findById(tenantId: string, sessionId: string): Promise<SaverSessionRef | null>;
}
