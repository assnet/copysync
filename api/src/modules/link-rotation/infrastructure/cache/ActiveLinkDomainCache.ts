import type { ILinkDomainRepository } from '../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../domain/entities/LinkDomain';

export const ACTIVE_LINK_DOMAIN_TTL_MS = 60_000;
/** Depois de falha sem lista anterior, espera isto antes de tentar o banco de novo. */
export const ACTIVE_LINK_DOMAIN_RETRY_MS = 5_000;

export interface ActiveLinkDomainCacheOptions {
  ttlMs?: number;
  retryMs?: number;
  now?: () => number;
  onError?: (err: unknown) => void;
}

/**
 * Cache em memória (TTL 60 s) dos domínios de link ACTIVE — o hook por Host consulta isto a
 * cada requisição. Não é estado operacional: perdê-lo só custa uma consulta. Carrega sob
 * demanda (nunca no boot), uma consulta por vez (single flight).
 *
 * Falha ao carregar: loga, devolve a última lista boa (se houver) e só tenta de novo após
 * `retryMs`; sem lista boa, devolve null (o hook não intercepta nada).
 */
export class ActiveLinkDomainCache implements Pick<ILinkDomainRepository, 'listActive'> {
  private value: readonly LinkDomain[] | null = null;
  private expiresAt = 0;
  private inflight: Promise<readonly LinkDomain[] | null> | null = null;
  private readonly ttlMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;

  constructor(
    private readonly load: () => Promise<LinkDomain[]>,
    private readonly options: ActiveLinkDomainCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? ACTIVE_LINK_DOMAIN_TTL_MS;
    this.retryMs = options.retryMs ?? ACTIVE_LINK_DOMAIN_RETRY_MS;
    this.now = options.now ?? Date.now;
  }

  async get(): Promise<readonly LinkDomain[] | null> {
    if (this.now() < this.expiresAt) return this.value;
    return (this.inflight ??= this.refresh().finally(() => { this.inflight = null; }));
  }

  /** Contrato do use case: lista vazia quando indisponível. */
  async listActive(): Promise<LinkDomain[]> {
    return [...((await this.get()) ?? [])];
  }

  private async refresh(): Promise<readonly LinkDomain[] | null> {
    try {
      this.value = await this.load();
      this.expiresAt = this.now() + this.ttlMs;
    } catch (err) {
      this.options.onError?.(err);
      this.expiresAt = this.now() + this.retryMs;
    }
    return this.value;
  }
}
