/**
 * Razão local do lease: `sessionId → lastRenewOkAt` das sessões cujo lease este processo
 * detém. Espelho do banco (permitido por `docs/arquitetura-escala.md` §6); o banco é a verdade.
 */
export class SessionLeaseLedger {
  private readonly entries = new Map<string, Date>();

  /** Registra aquisição/renovação bem-sucedida. */
  markOk(sessionId: string, at: Date): void {
    this.entries.set(sessionId, at);
  }

  drop(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  lastOk(sessionId: string): Date | undefined {
    return this.entries.get(sessionId);
  }
}
