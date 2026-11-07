/** Eventos de login gravados para a proteção (docs/seguranca-login.md). */
export type LoginEventType = 'LOGIN_FAILED' | 'LOGIN_OK' | 'LOGIN_CODE_VERIFIED';

export interface LoginEventInput {
  type: LoginEventType;
  email: string;
  ip: string | null;
  /** Só em LOGIN_OK/LOGIN_CODE_VERIFIED: falha nunca grava userId (o IP do atacante viraria o da vítima). */
  userId: string | null;
  userAgent: string | null;
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
  record(input: LoginEventInput): Promise<void>;
  /** Falhas do e-mail desde `since` (e depois do último LOGIN_OK/LOGIN_CODE_VERIFIED, se `afterReset`). */
  emailFailuresSince(email: string, since: Date, afterReset: boolean): Promise<Date[]>;
  ipFailuresSince(ip: string, since: Date): Promise<Date[]>;
  /** Poda simples: apaga eventos e códigos mais antigos que os cortes. */
  prune(eventsBefore: Date, codesBefore: Date): Promise<void>;
}

export interface ILoginCodeRepository {
  /** Cria o código ainda não enviado (conta no teto enquanto existir; apagado se o envio falhar). */
  createPending(input: { userId: string; codeHash: string; expiresAt: Date }): Promise<LoginCodeRecord>;
  /** Marca enviado e invalida os códigos anteriores ainda abertos do usuário. */
  markSent(id: string, userId: string, sentAt: Date): Promise<void>;
  deletePending(id: string): Promise<void>;
  /** Datas de criação dos códigos do usuário desde `since` (teto de envios). */
  createdSince(userId: string, since: Date): Promise<Date[]>;
  /** Último código enviado, não consumido e não invalidado. */
  findLatestOpen(userId: string): Promise<LoginCodeRecord | null>;
  /** +1 tentativa de forma atômica; null se o código já passou do teto/foi fechado. */
  registerAttempt(id: string, maxAttempts: number): Promise<number | null>;
  consume(id: string, at: Date): Promise<boolean>;
}
