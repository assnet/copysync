/**
 * Controle de socket local para o lease de sessão (ver docs/arquitetura-escala.md §3.1).
 *
 * Só fecha sockets deste processo; nunca grava status nem chaves: quem perde o lease não
 * pode escrever nada da sessão, e o shutdown grava as chaves num passo próprio depois.
 */
export interface ISessionSocketControl {
  /**
   * Derruba o socket local da sessão sem gravar status nem auth state (pendente vai fora)
   * e cancela a reconexão automática pendente. Sem socket local: não faz nada.
   */
  abortSession(sessionId: string): Promise<void>;
  /** Fecha todos os sockets locais; os handles de auth state ficam para o flush seguinte. */
  closeAllSockets(): Promise<void>;
  /** Ids das sessões com socket aberto neste processo. */
  listLocalSessionIds(): string[];
}
