import type { ITenantAiCredentialRepository } from '../../domain/contracts/ITenantAiCredentialRepository';
import type { IAiAuditTrail } from '../../domain/contracts/IAiAuditTrail';
import type { TenantAiCredential } from '../../domain/entities/TenantAiCredential';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import { tenantCredentialAad } from '../../domain/services/aiProviderDefaults';
import { AiCredentialInvalidError, AiCredentialNotFoundError } from '../../../../shared/errors/internal/AiErrors';
import type { UpsertTenantAiCredentialInput } from '../dtos/AiDTO';
import { resolveModel, validateApiKey } from './aiValidation';

/**
 * Cadastra ou edita a chave própria do tenant. Chave vazia mantém a atual, exceto na criação
 * e na troca de provedor (uma chave Anthropic não serve na OpenAI).
 */
export class UpsertTenantAiCredentialUseCase {
  constructor(
    private readonly repo: ITenantAiCredentialRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly audit: IAiAuditTrail,
  ) {}

  async execute(input: UpsertTenantAiCredentialInput): Promise<TenantAiCredential> {
    const model = resolveModel(input.kind, input.model);
    const apiKey = validateApiKey(input.apiKey);

    if (!apiKey) {
      const existing = await this.repo.find(input.tenantId);
      if (!existing || existing.kind !== input.kind) {
        throw new AiCredentialInvalidError('API key is required', 'apiKey');
      }
    }

    const credential = await this.repo.upsert({
      tenantId: input.tenantId,
      kind: input.kind,
      model,
      enabled: input.enabled ?? true,
      ...(apiKey && { apiKey: this.cipher().encrypt(apiKey, tenantCredentialAad(input.tenantId)) }),
    });

    await this.audit.record({
      action: 'AI_CREDENTIAL_UPSERTED',
      userId: input.userId,
      tenantId: input.tenantId,
      meta: { kind: credential.kind, model: credential.model, keyChanged: apiKey !== null },
    });
    return credential;
  }
}

export class DeleteTenantAiCredentialUseCase {
  constructor(
    private readonly repo: ITenantAiCredentialRepository,
    private readonly audit: IAiAuditTrail,
  ) {}

  async execute(input: { tenantId: string; userId: string }): Promise<void> {
    if (!(await this.repo.delete(input.tenantId))) throw new AiCredentialNotFoundError();
    await this.audit.record({ action: 'AI_CREDENTIAL_DELETED', userId: input.userId, tenantId: input.tenantId });
  }
}
