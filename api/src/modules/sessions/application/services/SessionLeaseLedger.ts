/**
 * Razão local do lease: `sessionId → lastRenewOkAt` das sessões cujo lease este processo
 * detém. Espelho do banco (permitido por `docs/arquitetura-escala.md` §6); o banco é a verdade.
 */
export class SessionLeaseLedger {
  private readonly entries = new Map<string, Date>();
  /** Sessões derrubadas por fence de erro de banco (sem prova de outro dono): reabrir quando o banco voltar. */
  /** Valor = tentativas de reabrir que falharam por erro transitório (limite em `RenewSessionLeaseUseCase`). */
  private readonly fenced = new Map<string, number>();

  /** Registra aquisição/renovação bem-sucedida (lease de novo nosso: deixa de ser derrubada por fence). */
  markOk(sessionId: string, at: Date): void {
    this.entries.set(sessionId, at);
    this.fenced.delete(sessionId);
  }

  /** Tira do razão e marca como derrubada por fence (`attempts` = falhas de reabrir já contadas). */
  markFenced(sessionId: string, attempts = 0): void {
    this.entries.delete(sessionId);
    this.fenced.set(sessionId, attempts);
  }

  /** Falhas de reabrir já contadas da suspensa; `0` se não está marcada. */
  fenceAttempts(sessionId: string): number {
    return this.fenced.get(sessionId) ?? 0;
  }

  clearFenced(sessionId: string): void {
    this.fenced.delete(sessionId);
  }

  fencedIds(): string[] {
    return [...this.fenced.keys()];
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
