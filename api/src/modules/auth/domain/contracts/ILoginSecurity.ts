/** Verificação server-side do desafio anti-robô (Turnstile). */
export interface ITurnstileVerifier {
  verify(token: string, ip: string | null): Promise<{ success: boolean; errorCodes?: string[] }>;
}

/** Ticket curto do passo de código: assinado, ligado ao usuário, sem valor como token de acesso. */
export interface ILoginTicketSigner {
  issue(userId: string, ttlMs: number, now: number): string;
  /** userId do ticket válido ou null (assinatura, propósito ou validade inválidos). */
  verify(ticket: string, now: number): string | null;
}

/** Hash do código de 6 dígitos com segredo do servidor (nunca o código em claro). */
export interface ILoginCodeHasher {
  generate(): string;
  hash(userId: string, code: string): string;
  matches(userId: string, code: string, hash: string): boolean;
}
