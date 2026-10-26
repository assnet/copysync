import type { IAiPlatformProviderRepository } from '../../domain/contracts/IAiPlatformProviderRepository';
import type { ITenantAiCredentialRepository } from '../../domain/contracts/ITenantAiCredentialRepository';
import type { IAiTextProviderAdapter } from '../../domain/contracts/IAiTextProviderAdapter';
import type { AiProviderKind } from '../../domain/enums/AiProviderKind';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import { platformProviderAad, tenantCredentialAad } from '../../domain/services/aiProviderDefaults';
import { AppError } from '../../../../shared/errors/AppError';
import {
  AI_PROVIDER_ERROR_CODES,
  AiCredentialNotFoundError,
  AiPlatformProviderNotFoundError,
} from '../../../../shared/errors/internal/AiErrors';
import type { AiTestResultDTO } from '../dtos/AiDTO';

export type AiAdapterResolver = (kind: AiProviderKind) => IAiTextProviderAdapter;

/** Geração mínima: só prova que chave e modelo respondem. Não grava uso. */
async function probe(adapter: IAiTextProviderAdapter, apiKey: string, model: string): Promise<AiTestResultDTO> {
  try {
    await adapter.generate({ apiKey, model, system: 'Reply with: OK', prompt: 'ping', maxOutputTokens: 16 });
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError && (AI_PROVIDER_ERROR_CODES as readonly string[]).includes(err.code)) {
      return { ok: false, errorCode: err.code };
    }
    throw err;
  }
}

export class TestAiPlatformProviderUseCase {
  constructor(
    private readonly repo: IAiPlatformProviderRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly adapters: AiAdapterResolver,
  ) {}

  async execute(id: string): Promise<AiTestResultDTO> {
    const provider = await this.repo.findById(id);
    const blob = provider ? await this.repo.findKey(id) : null;
    if (!provider || !blob) throw new AiPlatformProviderNotFoundError(id);
    const apiKey = this.cipher().decrypt(blob, platformProviderAad(id));
    return probe(this.adapters(provider.kind), apiKey, provider.model);
  }
}

export class TestTenantAiCredentialUseCase {
  constructor(
    private readonly repo: ITenantAiCredentialRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly adapters: AiAdapterResolver,
  ) {}

  async execute(tenantId: string): Promise<AiTestResultDTO> {
    const credential = await this.repo.find(tenantId);
    const blob = credential ? await this.repo.findKey(tenantId) : null;
    if (!credential || !blob) throw new AiCredentialNotFoundError();
    const apiKey = this.cipher().decrypt(blob, tenantCredentialAad(tenantId));
    return probe(this.adapters(credential.kind), apiKey, credential.model);
  }
}
