import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IChatEntitlementGate } from '../../domain/contracts/IChatEntitlementGate';
import { logger } from '../../../../shared/logger/logger';
import { TtlCache } from './ttlCache';

export const CHAT_ENTITLEMENT_KEY = 'chat_enabled';
/** Sem evento de invalidação entre processos (webhook no `http`, ingestão no dono da sessão). */
export const CHAT_ENTITLEMENT_TTL_MS = 45_000;

/**
 * `chat_enabled` lido de `tenant_entitlements` via `IEntitlementReader.getBoolean`, com cache por
 * tenant. Chave ausente ou não booleana = desligado. Falha de leitura = ligado (comportamento de
 * hoje), sem guardar no cache.
 */
export class CachedChatEntitlementGate implements IChatEntitlementGate {
  private readonly cache: TtlCache<boolean>;

  constructor(
    private readonly reader: Pick<IEntitlementReader, 'getBoolean'>,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.cache = new TtlCache<boolean>(opts.ttlMs ?? CHAT_ENTITLEMENT_TTL_MS, 10_000, opts.now);
  }

  async isChatEnabled(tenantId: string): Promise<boolean> {
    try {
      return await this.cache.get(tenantId, async () =>
        (await this.reader.getBoolean(tenantId, CHAT_ENTITLEMENT_KEY)) === true);
    } catch (err) {
      logger.warn({ err, tenantId }, 'Failed to read chat entitlement; keeping chat ingestion');
      return true;
    }
  }
}
