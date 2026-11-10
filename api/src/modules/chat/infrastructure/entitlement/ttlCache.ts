/**
 * Cache em memória com TTL e leitura única por chave em andamento. Só cache de leitura do banco:
 * perder o processo perde só o atalho (AGENTS, escala). Erro do loader não fica guardado.
 */
export class TtlCache<V> {
  private readonly values = new Map<string, { value: V; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.values.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const p = load()
      .then((value) => {
        this.prune();
        this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  /** Acima do teto: tira os vencidos; ainda cheio, esvazia (só custa novas leituras). */
  private prune(): void {
    if (this.values.size < this.maxEntries) return;
    const t = this.now();
    for (const [k, v] of this.values) if (v.expiresAt <= t) this.values.delete(k);
    if (this.values.size >= this.maxEntries) this.values.clear();
  }
}
