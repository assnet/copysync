import type { AiPlatformProvider } from '../../domain/entities/AiPlatformProvider';
import type { TenantAiCredential } from '../../domain/entities/TenantAiCredential';
import { MASKED_API_KEY } from '../../domain/services/aiProviderDefaults';
import type { AiCredentialView } from '../../application/dtos/AiDTO';

/** Saída HTTP. Lista fechada de campos: chave nunca sai, só `hasKey`/`masked`. */
export const AiPresenter = {
  provider(p: AiPlatformProvider) {
    return {
      id: p.id,
      kind: p.kind,
      label: p.label,
      model: p.model,
      enabled: p.enabled,
      priority: p.priority,
      dailyLimitPerTenant: p.dailyLimitPerTenant,
      hasKey: p.hasKey,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  },

  credential(c: TenantAiCredential): AiCredentialView {
    return { kind: c.kind, model: c.model, masked: MASKED_API_KEY, enabled: c.enabled };
  },
};
