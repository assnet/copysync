import type { IAiSettingsRepository } from '../../domain/contracts/IAiSettingsRepository';
import type { IAiPlatformProviderRepository } from '../../domain/contracts/IAiPlatformProviderRepository';
import type { ITenantAiCredentialRepository } from '../../domain/contracts/ITenantAiCredentialRepository';
import type { IAiEntitlementReader } from '../../domain/contracts/IAiEntitlementReader';
import { isPlatformAvailable, resolveAiMode } from '../../domain/services/aiModes';
import { MASKED_API_KEY } from '../../domain/services/aiProviderDefaults';
import type { AiStatusDTO } from '../dtos/AiDTO';

/** O que o painel do tenant mostra em Configurações → IA. Não usa a cifra. */
export class GetAiStatusUseCase {
  constructor(
    private readonly settings: IAiSettingsRepository,
    private readonly providers: IAiPlatformProviderRepository,
    private readonly credentials: ITenantAiCredentialRepository,
    private readonly entitlements: IAiEntitlementReader,
  ) {}

  async execute(tenantId: string): Promise<AiStatusDTO> {
    const [settings, entitlementEnabled, provider, credential] = await Promise.all([
      this.settings.get(),
      this.entitlements.isAiRewriteEnabled(tenantId),
      this.providers.findFirstEnabled(),
      this.credentials.find(tenantId),
    ]);
    const facts = {
      settings,
      entitlementEnabled,
      hasEnabledPlatformProvider: provider !== null && provider.hasKey,
      tenantCredentialEnabled: credential?.enabled ?? false,
    };
    return {
      mode: resolveAiMode(facts),
      tenantKeysAllowed: settings.tenantKeysEnabled,
      platformAvailable: isPlatformAvailable(facts),
      credential: credential
        ? { kind: credential.kind, model: credential.model, masked: MASKED_API_KEY, enabled: credential.enabled }
        : null,
    };
  }
}
