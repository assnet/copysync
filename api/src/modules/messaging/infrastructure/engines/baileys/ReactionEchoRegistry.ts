/**
 * Ids das reações que esta engine enviou e cujo eco ainda não voltou, por sessão.
 *
 * O WhatsApp devolve a nossa própria reação pelo `messages.reaction`; reconhecer esse eco
 * (`isEcho`) é o que permite à ingestão manter o carimbo que fixamos em vez de usar o
 * relógio do recebimento (design de reações, §4 "Relógio").
 *
 * Regras:
 * - o id é registrado **antes** do envio: o eco é emitido de dentro do `sendMessage`
 * - falha de envio **não** retira o id — timeout pode ocorrer depois de o WhatsApp aceitar
 * - só o eco recebido (`consume`) ou o TTL retiram o id
 * - teto cheio: sai primeiro id vencido; só sem vencido sai o mais antigo, com aviso
 *
 * Memória basta: envio e eco acontecem no mesmo processo. Classe pura, relógio injetável.
 */
export interface ReactionEchoRegistryOptions {
  ttlMs: number;
  /** Teto por sessão — derivado do limite de envio em `shared/config/env.ts`. */
  maxPerSession: number;
  now?: () => number;
  /** Chamado quando o teto obriga a descartar um id ainda dentro do TTL. */
  onForcedEviction?: (sessionId: string, reactionId: string) => void;
}

export class ReactionEchoRegistry {
  /** sessionId → (reactionId → expira em). Map preserva a ordem de inserção: o primeiro é o mais antigo. */
  private readonly sessions = new Map<string, Map<string, number>>();
  private readonly now: () => number;

  constructor(private readonly options: ReactionEchoRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  register(sessionId: string, reactionId: string): void {
    let ids = this.sessions.get(sessionId);
    if (!ids) {
      ids = new Map();
      this.sessions.set(sessionId, ids);
    }
    ids.delete(reactionId);

    if (ids.size >= this.options.maxPerSession) {
      this.dropExpired(ids);
    }
    if (ids.size >= this.options.maxPerSession) {
      const oldest = ids.keys().next().value as string;
      ids.delete(oldest);
      this.options.onForcedEviction?.(sessionId, oldest);
    }

    ids.set(reactionId, this.now() + this.options.ttlMs);
  }

  /** true quando o id foi enviado por nós e ainda está no TTL; o id sai do registro. */
  consume(sessionId: string, reactionId: string): boolean {
    const ids = this.sessions.get(sessionId);
    const expiresAt = ids?.get(reactionId);
    if (!ids || expiresAt === undefined) return false;

    ids.delete(reactionId);
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
