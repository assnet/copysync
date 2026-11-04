import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

export interface SessionChannelLimit {
  used: number;
  /** null = ilimitado (entitlement ausente). */
  limit: number | null;
}

export interface GetSessionLimitsOutput {
  whatsapp: SessionChannelLimit;
  telegram: SessionChannelLimit & { enabled: boolean };
}

/** Contadores "usadas / limite" por canal, para o painel decidir se oferece nova sessão. */
export class GetSessionLimitsUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly entitlements: IEntitlementReader,
    private readonly enabledEngines: ReadonlySet<string>,
  ) {}

  async execute(input: { tenantId: string }): Promise<GetSessionLimitsOutput> {
    const [used, whatsappLimit, telegramLimit] = await Promise.all([
      this.sessionRepo.countByEngine(input.tenantId),
      this.entitlements.getNumber(input.tenantId, ENTITLEMENT_KEYS.WHATSAPP_SESSIONS),
      this.entitlements.getNumber(input.tenantId, ENTITLEMENT_KEYS.TELEGRAM_SESSIONS),
    ]);
    return {
      whatsapp: { used: used.baileys ?? 0, limit: whatsappLimit },
      telegram: { used: used.telegram ?? 0, limit: telegramLimit, enabled: this.enabledEngines.has('telegram') },
    };
  }
}
