import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IChatEntitlementGate } from '../../domain/contracts/IChatEntitlementGate';
import { logger } from '../../../../shared/logger/logger';
import { TtlCache } from './ttlCache';

export const CHAT_ENTITLEMENT_KEY = 'chat_enabled';
/** Sem evento de invalidação entre processos (webhook no `http`, ingestão no dono da sessão). */
export const CHAT_ENTITLEMENT_TTL_MS = 45_000;
/** Prazo da leitura do entitlement; estourou = falha (fallback ligado). */
export const CHAT_ENTITLEMENT_READ_TIMEOUT_MS = 1_000;
/** Quanto o fallback "ligado" vale após falha/prazo: banco lento não é consultado a cada mensagem. */
export const CHAT_ENTITLEMENT_FALLBACK_TTL_MS = 10_000;
const MAX_FALLBACK_ENTRIES = 10_000;

/**
 * `chat_enabled` lido de `tenant_entitlements` via `IEntitlementReader.getBoolean`, com cache por
 * tenant. Chave ausente ou não booleana = desligado. Falha ou prazo de leitura = último valor
 * conhecido do tenant (banco lento não liga a ingestão de quem tem chat desligado); sem valor
 * prévio = ligado (comportamento de hoje). Guardado por `CHAT_ENTITLEMENT_FALLBACK_TTL_MS` com
 * um warn por tenant por janela.
 */
export class CachedChatEntitlementGate implements IChatEntitlementGate {
  private readonly cache: TtlCache<boolean>;
  /** tenantId → janela do fallback e valor usado nela. */
  private readonly fallback = new Map<string, { until: number; value: boolean }>();
  /** tenantId → último valor lido com sucesso (sem TTL; só usado em falha de leitura). */
  private readonly lastKnown = new Map<string, boolean>();
  private readonly now: () => number;
  private readonly readTimeoutMs: number;
  private readonly fallbackTtlMs: number;

  constructor(
    private readonly reader: Pick<IEntitlementReader, 'getBoolean'>,
    opts: { ttlMs?: number; now?: () => number; readTimeoutMs?: number; fallbackTtlMs?: number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.readTimeoutMs = opts.readTimeoutMs ?? CHAT_ENTITLEMENT_READ_TIMEOUT_MS;
    this.fallbackTtlMs = opts.fallbackTtlMs ?? CHAT_ENTITLEMENT_FALLBACK_TTL_MS;
    this.cache = new TtlCache<boolean>(opts.ttlMs ?? CHAT_ENTITLEMENT_TTL_MS, 10_000, this.now);
  }

  async isChatEnabled(tenantId: string): Promise<boolean> {
    const active = this.activeFallback(tenantId);
    if (active !== null) return active;
    try {
      return await this.cache.get(tenantId, async () => {
        const enabled = (await this.readWithTimeout(tenantId)) === true;
        if (this.lastKnown.size >= MAX_FALLBACK_ENTRIES && !this.lastKnown.has(tenantId)) this.lastKnown.clear();
        this.lastKnown.set(tenantId, enabled);
        return enabled;
      });
    } catch (err) {
      // Leituras simultâneas compartilham a mesma falha: só a primeira abre a janela e loga.
      const current = this.activeFallback(tenantId);
      if (current !== null) return current;
      const value = this.lastKnown.get(tenantId) ?? true;
      if (this.fallback.size >= MAX_FALLBACK_ENTRIES) this.fallback.clear();
      this.fallback.set(tenantId, { until: this.now() + this.fallbackTtlMs, value });
      logger.warn({ err: (err as Error)?.message, tenantId, value }, 'Failed to read chat entitlement; using last known value');
      return value;
    }
  }

  /** Valor da janela de fallback ainda válida, ou null. */
  private activeFallback(tenantId: string): boolean | null {
    const entry = this.fallback.get(tenantId);
    if (!entry) return null;
    if (entry.until > this.now()) return entry.value;
    this.fallback.delete(tenantId);
    return null;
  }

  private readWithTimeout(tenantId: string): Promise<boolean | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('chat entitlement read timeout')), this.readTimeoutMs);
      timer.unref?.();
    });
    return Promise.race([this.reader.getBoolean(tenantId, CHAT_ENTITLEMENT_KEY), timeout])
      .finally(() => clearTimeout(timer));
  }
}
