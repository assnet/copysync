import crypto from 'node:crypto';
import type { ILoginCodeHasher, ILoginTicketSigner } from '../../domain/contracts/ILoginSecurity';

const TICKET_PURPOSE = 'login-code';
const TICKET_VERSION = 'lt1';

const deriveKey = (secret: string, label: string) => crypto.createHmac('sha256', secret).update(label).digest();
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Ticket `lt1.<payload>.<hmac>` com chave derivada do JWT_SECRET (rótulo próprio): não é JWT
 * nem token de acesso, então nenhuma rota autenticada o aceita.
 */
export class HmacLoginTicketSigner implements ILoginTicketSigner {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = deriveKey(secret, 'login-ticket-v1');
  }

  issue(userId: string, ttlMs: number, now: number): string {
    const payload = b64url(JSON.stringify({ sub: userId, p: TICKET_PURPOSE, exp: now + ttlMs }));
    return `${TICKET_VERSION}.${payload}.${this.sign(payload)}`;
  }

  verify(ticket: string, now: number): string | null {
    const parts = typeof ticket === 'string' ? ticket.split('.') : [];
    if (parts.length !== 3 || parts[0] !== TICKET_VERSION) return null;
    const [, payload, sig] = parts;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; p?: unknown; exp?: unknown };
      if (p.p !== TICKET_PURPOSE || typeof p.sub !== 'string' || typeof p.exp !== 'number' || p.exp <= now) return null;
      return p.sub;
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return crypto.createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

/** Código de 6 dígitos (CSPRNG) e hash HMAC ligado ao usuário: o banco vazado não revela o código. */
export class HmacLoginCodeHasher implements ILoginCodeHasher {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = deriveKey(secret, 'login-code-v1');
  }

  generate(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hash(userId: string, code: string): string {
    return crypto.createHmac('sha256', this.key).update(`${userId}:${code}`).digest('hex');
  }

  matches(userId: string, code: string, hash: string): boolean {
    const a = Buffer.from(this.hash(userId, code));
    const b = Buffer.from(hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

/** Referência do e-mail para log: HMAC (chave derivada, rótulo próprio), 12 hex. Sem o segredo não dá para testar e-mails. */
export function createEmailRef(secret: string): (email: string) => string {
  const key = deriveKey(secret, 'login-email-ref-v1');
  return (email) => crypto.createHmac('sha256', key).update(email).digest('hex').slice(0, 12);
}
