/** Ação sensível que pediu a senha do usuário logado (texto livre no banco; uma por fluxo). */
export type PasswordConfirmationAction = 'STOREFRONT_DELETE';

export interface ReservePasswordConfirmationInput {
  userId: string;
  action: PasswordConfirmationAction;
  createdAt: Date;
}

/**
 * Tentativas de confirmação de senha (docs/seguranca-login.md). A tentativa é gravada como falha
 * ANTES do bcrypt (reserva) e só vira sucesso depois: confirmações paralelas não testam mais
 * senhas que o teto. Nunca recebe a senha.
 */
export interface IPasswordConfirmationRepository {
  /** Roda `fn` com trava exclusiva por usuário (multi-instância); nunca segurar durante o bcrypt. */
  withUserLock<T>(userId: string, fn: (repo: IPasswordConfirmationRepository) => Promise<T>): Promise<T>;
  /** Datas das falhas (inclui reservas em andamento) do usuário desde `since`, em qualquer ação. */
  failuresSince(userId: string, since: Date): Promise<Date[]>;
  /** Grava a tentativa como falha e devolve o id. */
  reserve(input: ReservePasswordConfirmationInput): Promise<string>;
  /** Senha conferiu: a tentativa deixa de contar como falha (o histórico de falhas fica). */
  markSucceeded(id: string): Promise<void>;
  /** Erro inesperado antes do veredito: apaga a reserva (idempotente). */
  discard(id: string): Promise<void>;
  /** Poda: apaga as tentativas do usuário anteriores a `before`. */
  pruneUser(userId: string, before: Date): Promise<void>;
}
