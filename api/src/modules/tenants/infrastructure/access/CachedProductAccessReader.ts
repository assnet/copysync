import type { IProductAccessReader } from '../../domain/contracts/IProductAccessReader';
import type { ITenantProductRepository } from '../../domain/contracts/ITenantProductRepository';
import {
  accessSourceOf,
  listProductAccess,
  resolveProductAccess,
  type ProductAccessRow,
  type ProductKey,
} from '../../domain/services/resolveProductAccess';

/** Sem evento de invalidação entre processos: corte vale em até 45 s (mesmo atraso do gate de chat). */
export const PRODUCT_ACCESS_TTL_MS = 45_000;
/** Prazo da leitura; estourou = falha (o gate decide: `enforce` → 503). */
export const PRODUCT_ACCESS_READ_TIMEOUT_MS = 1_000;
const MAX_ENTRIES = 10_000;

type Rows = ReadonlyMap<ProductKey, ProductAccessRow>;

/**
 * Linhas de `tenant_products` por tenant, em cache por processo (TTL 45 s). É cache de leitura do banco,
 * não estado operacional: reinício só esfria o cache. Leituras simultâneas do mesmo tenant compartilham
 * uma consulta; erro não fica guardado e sobe para quem chamou.
 */
export class CachedProductAccessReader implements IProductAccessReader {
  private readonly values = new Map<string, { rows: Rows; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<Rows>>();
  /** Geração por tenant: leitura iniciada antes de `invalidate` não repõe dado velho no cache. */
  private readonly generation = new Map<string, number>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly readTimeoutMs: number;

  constructor(
    private readonly repository: Pick<ITenantProductRepository, 'findAll'>,
    opts: { ttlMs?: number; now?: () => number; readTimeoutMs?: number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? PRODUCT_ACCESS_TTL_MS;
    this.readTimeoutMs = opts.readTimeoutMs ?? PRODUCT_ACCESS_READ_TIMEOUT_MS;
  }

  async has(tenantId: string, product: ProductKey): Promise<boolean> {
    const rows = await this.rows(tenantId);
    return resolveProductAccess(product, rows.get(accessSourceOf(product)) ?? null);
  }

  async list(tenantId: string): Promise<ProductKey[]> {
    return listProductAccess(await this.rows(tenantId));
  }

  invalidate(tenantId: string): void {
    this.values.delete(tenantId);
    this.pending.delete(tenantId);
    this.generation.set(tenantId, (this.generation.get(tenantId) ?? 0) + 1);
  }

  private rows(tenantId: string): Promise<Rows> {
    const hit = this.values.get(tenantId);
    if (hit && hit.expiresAt > this.now()) return Promise.resolve(hit.rows);
    const inFlight = this.pending.get(tenantId);
    if (inFlight) return inFlight;
    const gen = this.generation.get(tenantId) ?? 0;
    const p = this.read(tenantId)
      .then((rows) => {
        if ((this.generation.get(tenantId) ?? 0) === gen) {
          this.prune();
          this.values.set(tenantId, { rows, expiresAt: this.now() + this.ttlMs });
        }
        return rows;
      })
      .finally(() => {
        if (this.pending.get(tenantId) === p) this.pending.delete(tenantId);
      });
    this.pending.set(tenantId, p);
    return p;
  }

  private async read(tenantId: string): Promise<Rows> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('product access read timeout')), this.readTimeoutMs);
      timer.unref?.();
    });
    try {
      const list = await Promise.race([this.repository.findAll(tenantId), timeout]);
      return new Map(list.map((r) => [r.product, { status: r.status }]));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Acima do teto: tira os vencidos; ainda cheio, esvazia (só custa novas leituras). */
  private prune(): void {
    if (this.values.size < MAX_ENTRIES) return;
    const t = this.now();
    for (const [k, v] of this.values) if (v.expiresAt <= t) this.values.delete(k);
    if (this.values.size >= MAX_ENTRIES) this.values.clear();
    if (this.generation.size >= MAX_ENTRIES) this.generation.clear();
  }
}
