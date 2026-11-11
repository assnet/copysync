import type { PasswordResetTokenState } from '../services/passwordResetRules';

export interface PasswordResetRecord extends PasswordResetTokenState {
  id: string;
  email: string;
}

/** Pedidos de redefinição de senha (tabela `password_reset_requests`). Global, não tenant-aware. */
export interface IPasswordResetRepository {
  /** Grava o pedido (com ou sem conta) e devolve o id. */
  record(input: { email: string; ip: string | null }): Promise<string>;
  /** Pedido recusado pelo teto: não fica na contagem. */
  discard(id: string): Promise<void>;
  emailRequestsSince(email: string, since: Date, excludeId: string): Promise<Date[]>;
  ipRequestsSince(ip: string, since: Date, excludeId: string): Promise<Date[]>;
  /** Liga o pedido à conta e guarda só o hash do token. */
  attachToken(id: string, input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null>;
  /**
   * Numa transação: consome o token (só se aberto e no prazo), grava a senha, invalida os outros
   * links abertos da conta e revoga todos os refresh tokens e as sessões da extensão. `false` = token já não estava utilizável
   * (nada foi gravado).
   */
  consumeAndSetPassword(input: { id: string; userId: string; passwordHash: string; now: Date }): Promise<boolean>;
  prune(before: Date): Promise<void>;
}
