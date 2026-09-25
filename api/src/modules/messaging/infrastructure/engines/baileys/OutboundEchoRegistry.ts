/**
 * Ids das mensagens que esta engine enviou e cujo eco ainda não voltou, por sessão.
 *
 * O WhatsApp devolve o que enviamos (`emitOwnEvents`). Reconhecer esse eco evita tratá-lo
 * como mensagem vinda do celular: na reação, a ingestão mantém o carimbo que fixamos
 * (`isEcho`); na mídia, o eco é descartado antes do download.
 *
 * Regras:
 * - o id é registrado **antes** do envio: o eco é emitido de dentro do `sendMessage`
 * - falha de envio **não** retira o id — timeout pode ocorrer depois de o WhatsApp aceitar
 * - só o eco recebido (`consume`) ou o TTL retiram o id
 * - teto cheio: sai primeiro id vencido; só sem vencido sai o mais antigo, com aviso
 *
 * Memória basta: envio e eco acontecem no mesmo processo. Classe pura, relógio injetável.
 * As instâncias usadas pelo adapter são de módulo — ver `outboundEchoRegistries.ts`.
 */
export interface OutboundEchoRegistryOptions {
  ttlMs: number;
  /** Teto por sessão — vem de `shared/config/env.ts`. */
  maxPerSession: number;
  now?: () => number;
  /** Chamado quando o teto obriga a descartar um id ainda dentro do TTL. */
  onForcedEviction?: (sessionId: string, messageId: string) => void;
}

export class OutboundEchoRegistry {
  /** sessionId → (messageId → expira em). Map preserva a ordem de inserção: o primeiro é o mais antigo. */
  private readonly sessions = new Map<string, Map<string, number>>();
  private readonly now: () => number;

  constructor(private readonly options: OutboundEchoRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  register(sessionId: string, messageId: string): void {
    let ids = this.sessions.get(sessionId);
    if (!ids) {
      ids = new Map();
      this.sessions.set(sessionId, ids);
    }
    ids.delete(messageId);

    if (ids.size >= this.options.maxPerSession) {
      this.dropExpired(ids);
    }
    if (ids.size >= this.options.maxPerSession) {
      const oldest = ids.keys().next().value as string;
      ids.delete(oldest);
      this.options.onForcedEviction?.(sessionId, oldest);
    }

    ids.set(messageId, this.now() + this.options.ttlMs);
  }

  /** true quando o id foi enviado por nós e ainda está no TTL; o id sai do registro. */
  consume(sessionId: string, messageId: string): boolean {
    const ids = this.sessions.get(sessionId);
    const expiresAt = ids?.get(messageId);
    if (!ids || expiresAt === undefined) return false;

    ids.delete(messageId);
    if (ids.size === 0) this.sessions.delete(sessionId);
    return expiresAt >= this.now();
  }

  private dropExpired(ids: Map<string, number>): void {
    const now = this.now();
    for (const [id, expiresAt] of ids) {
      if (expiresAt < now) ids.delete(id);
    }
  }
}
