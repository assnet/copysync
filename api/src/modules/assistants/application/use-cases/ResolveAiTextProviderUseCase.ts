import type { IAiSettingsRepository } from '../../domain/contracts/IAiSettingsRepository';
import type { IAiPlatformProviderRepository } from '../../domain/contracts/IAiPlatformProviderRepository';
import type { ITenantAiCredentialRepository } from '../../domain/contracts/ITenantAiCredentialRepository';
import type { IAiEntitlementReader } from '../../domain/contracts/IAiEntitlementReader';
import type { AiProviderKind, AiUsageSource } from '../../domain/enums/AiProviderKind';
import type { EncryptedBlob, ISecretCipher } from '../../../../shared/security/ISecretCipher';
import { platformProviderAad, tenantCredentialAad } from '../../domain/services/aiProviderDefaults';
import { AiNotConfiguredError } from '../../../../shared/errors/internal/AiErrors';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

/** Teto diário por tenant na IA da plataforma quando nem provedor nem plano definem um. */
export const DEFAULT_PLATFORM_AI_REQUESTS_PER_DAY = 200;

/** Provedor escolhido para uma chamada. `apiKey` em claro: nunca logar nem devolver. */
export interface ResolvedAiProvider {
  source: AiUsageSource;
  kind: AiProviderKind;
  model: string;
  providerId: string | null;
  apiKey: string;
  /** Teto diário de chamadas (PLATFORM); null = sem teto (chave do tenant). */
  dailyLimit: number | null;
}

/**
 * Ordem (spec Parte B):
 * 1. plataforma ligada, entitlement `ai_rewrite_enabled` ≠ false e provedor ativo de menor
 *    `priority` → teto diário = `dailyLimitPerTenant` ?? `ai_requests_per_day` ?? 200 (a
 *    contagem atômica fica em `AiTextGeneratorService`);
 * 2. chaves de tenant ligadas e credencial ativa → chave do tenant, sem teto;
 * 3. senão 409 `AI_NOT_CONFIGURED`.
 * Falha da cifra (`SECRET_CIPHER_*`) vira `AI_NOT_CONFIGURED`: quem chama cai no modelo fixo.
 */
export class ResolveAiTextProviderUseCase {
  constructor(
    private readonly settings: IAiSettingsRepository,
    private readonly providers: IAiPlatformProviderRepository,
    private readonly credentials: ITenantAiCredentialRepository,
    private readonly entitlements: IAiEntitlementReader,
    private readonly cipher: () => ISecretCipher,
  ) {}

  async execute(tenantId: string): Promise<ResolvedAiProvider> {
    const settings = await this.settings.get();

    if (settings.platformEnabled && (await this.entitlements.isAiRewriteEnabled(tenantId))) {
      const provider = await this.providers.findFirstEnabled();
      const blob = provider ? await this.providers.findKey(provider.id) : null;
      if (provider && blob) {
        const dailyLimit =
          provider.dailyLimitPerTenant ??
          (await this.entitlements.aiRequestsPerDay(tenantId)) ??
          DEFAULT_PLATFORM_AI_REQUESTS_PER_DAY;
        return {
          source: 'PLATFORM',
          kind: provider.kind,
          model: provider.model,
          providerId: provider.id,
          apiKey: this.decrypt(tenantId, blob, platformProviderAad(provider.id)),
          dailyLimit,
        };
      }
    }

    if (settings.tenantKeysEnabled) {
      const credential = await this.credentials.find(tenantId);
      const blob = credential?.enabled ? await this.credentials.findKey(tenantId) : null;
      if (credential && blob) {
        return {
          source: 'TENANT',
          kind: credential.kind,
          model: credential.model,
          providerId: null,
          apiKey: this.decrypt(tenantId, blob, tenantCredentialAad(tenantId)),
          dailyLimit: null,
        };
      }
    }

    throw new AiNotConfiguredError();
  }

  /** Só o código vai para o log; nunca blob nem chave. */
  private decrypt(tenantId: string, blob: EncryptedBlob, aad: string): string {
    try {
      return this.cipher().decrypt(blob, aad);
    } catch (err) {
      if (err instanceof AppError && err.code.startsWith('SECRET_CIPHER_')) {
        logger.warn({ tenantId, code: err.code }, 'ai key decrypt failed');
        throw new AiNotConfiguredError();
      }
      throw err;
    }
  }
}
