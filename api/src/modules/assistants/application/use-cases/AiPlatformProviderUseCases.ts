import { randomUUID } from 'node:crypto';
import type { IAiPlatformProviderRepository } from '../../domain/contracts/IAiPlatformProviderRepository';
import type { IAiAuditTrail } from '../../domain/contracts/IAiAuditTrail';
import type { AiPlatformProvider } from '../../domain/entities/AiPlatformProvider';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import { platformProviderAad } from '../../domain/services/aiProviderDefaults';
import {
  AiCredentialInvalidError,
  AiPlatformProviderNotFoundError,
} from '../../../../shared/errors/internal/AiErrors';
import type { CreateAiPlatformProviderInput, UpdateAiPlatformProviderInput } from '../dtos/AiDTO';
import { resolveModel, validateApiKey } from './aiValidation';

export class ListAiPlatformProvidersUseCase {
  constructor(private readonly repo: IAiPlatformProviderRepository) {}

  execute(): Promise<AiPlatformProvider[]> {
    return this.repo.list();
  }
}

/** O id nasce aqui para a chave já ser cifrada com o AAD `platform:ai:<id>`. */
export class CreateAiPlatformProviderUseCase {
  constructor(
    private readonly repo: IAiPlatformProviderRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly audit: IAiAuditTrail,
    private readonly newId: () => string = randomUUID,
  ) {}

  async execute(input: CreateAiPlatformProviderInput): Promise<AiPlatformProvider> {
    const model = resolveModel(input.kind, input.model);
    const apiKey = validateApiKey(input.apiKey);
    if (!apiKey) throw new AiCredentialInvalidError('API key is required', 'apiKey');

    const id = this.newId();
    const provider = await this.repo.create({
      id,
      kind: input.kind,
      label: input.label.trim(),
      model,
      apiKey: this.cipher().encrypt(apiKey, platformProviderAad(id)),
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      dailyLimitPerTenant: input.dailyLimitPerTenant ?? null,
    });

    await this.audit.record({
      action: 'AI_PROVIDER_CREATED',
      userId: input.userId,
      meta: { providerId: id, kind: provider.kind, model: provider.model },
    });
    return provider;
  }
}

export class UpdateAiPlatformProviderUseCase {
  constructor(
    private readonly repo: IAiPlatformProviderRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly audit: IAiAuditTrail,
  ) {}

  async execute(input: UpdateAiPlatformProviderInput): Promise<AiPlatformProvider> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new AiPlatformProviderNotFoundError(input.id);

    const apiKey = validateApiKey(input.apiKey);
    const updated = await this.repo.update(input.id, {
      ...(input.label !== undefined && { label: input.label.trim() }),
      ...(input.model !== undefined && { model: resolveModel(current.kind, input.model) }),
      ...(apiKey && { apiKey: this.cipher().encrypt(apiKey, platformProviderAad(input.id)) }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.dailyLimitPerTenant !== undefined && { dailyLimitPerTenant: input.dailyLimitPerTenant }),
    });
    if (!updated) throw new AiPlatformProviderNotFoundError(input.id);

    await this.audit.record({
      action: 'AI_PROVIDER_UPDATED',
      userId: input.userId,
      meta: { providerId: input.id, keyChanged: apiKey !== null, enabled: updated.enabled },
    });
    return updated;
  }
}

export class DeleteAiPlatformProviderUseCase {
  constructor(
    private readonly repo: IAiPlatformProviderRepository,
    private readonly audit: IAiAuditTrail,
  ) {}

  async execute(input: { userId: string; id: string }): Promise<void> {
    if (!(await this.repo.delete(input.id))) throw new AiPlatformProviderNotFoundError(input.id);
    await this.audit.record({ action: 'AI_PROVIDER_DELETED', userId: input.userId, meta: { providerId: input.id } });
  }
}
