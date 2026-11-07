/**
 * Eventos de login gravados para a proteção (docs/seguranca-login.md).
 * LOGIN_ATTEMPT = tentativa em andamento (gravada ANTES de conferir a senha): conta no teto, para que
 * logins paralelos não testem mais senhas que o limite. Vira LOGIN_FAILED ou é apagada ao terminar.
 */
export type LoginEventType = 'LOGIN_ATTEMPT' | 'LOGIN_FAILED' | 'LOGIN_OK' | 'LOGIN_CODE_VERIFIED';

export interface LoginEventInput {
  type: LoginEventType;
  email: string;
  ip: string | null;
  /** Só em LOGIN_OK/LOGIN_CODE_VERIFIED: falha nunca grava userId (o IP do atacante viraria o da vítima). */
  userId: string | null;
  userAgent: string | null;
}

export interface FailureQuery {
  /** Conta também tentativas em andamento (LOGIN_ATTEMPT). */
  includePending?: boolean;
  /** Ignora esta linha (a própria tentativa). */
  excludeId?: string;
}

export interface LoginCodeRecord {
  id: string;
  userId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  sentAt: Date | null;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
}

export interface ILoginEventRepository {
  /** Grava o evento e devolve o id. */
  record(input: LoginEventInput): Promise<string>;
  /** LOGIN_ATTEMPT → LOGIN_FAILED. */
  markAttemptFailed(id: string): Promise<void>;
  /** Apaga a tentativa se ainda estiver em andamento (idempotente). */
  discardAttempt(id: string): Promise<void>;
  /** Falhas do e-mail desde `since` (com `afterReset`, só depois do último LOGIN_OK/LOGIN_CODE_VERIFIED). */
  emailFailuresSince(email: string, since: Date, afterReset: boolean, q?: FailureQuery): Promise<Date[]>;
  ipFailuresSince(ip: string, since: Date, q?: FailureQuery): Promise<Date[]>;
  /** Poda simples: apaga eventos e códigos mais antigos que os cortes. */
  prune(eventsBefore: Date, codesBefore: Date): Promise<void>;
}

export interface ILoginCodeRepository {
  /**
   * Executa `fn` com trava exclusiva por usuário (multi-instância). Usado para avaliar o teto e
   * reservar o código sem corrida; nunca segurar a trava durante o envio do e-mail.
   */
  withUserLock<T>(userId: string, fn: (repo: ILoginCodeRepository) => Promise<T>): Promise<T>;
  /** Cria o código ainda não enviado (conta no teto enquanto existir; apagado se o envio falhar). */
  createPending(input: { userId: string; codeHash: string; expiresAt: Date }): Promise<LoginCodeRecord>;
  /** Marca enviado e invalida os códigos JÁ ENVIADOS antes dele ainda abertos. */
  markSent(id: string, userId: string, sentAt: Date): Promise<void>;
  deletePending(id: string): Promise<void>;
  /** Datas de criação dos códigos do usuário desde `since` (teto de envios). */
  createdSince(userId: string, since: Date): Promise<Date[]>;
  /** Datas de criação dos códigos esgotados (tentativas ≥ `maxAttempts`) desde `since`. */
  exhaustedSince(userId: string, since: Date, maxAttempts: number): Promise<Date[]>;
  /** Último código enviado, não consumido e não invalidado. */
  findLatestOpen(userId: string): Promise<LoginCodeRecord | null>;
  /** +1 tentativa de forma atômica; null se o código já passou do teto/foi fechado. */
  registerAttempt(id: string, maxAttempts: number): Promise<number | null>;
  consume(id: string, at: Date): Promise<boolean>;
}
