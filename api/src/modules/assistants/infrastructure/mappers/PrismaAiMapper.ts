import type {
  AiPlatformProvider as PrismaAiPlatformProvider,
  TenantAiCredential as PrismaTenantAiCredential,
} from '@prisma/client';
import type { AiPlatformProvider } from '../../domain/entities/AiPlatformProvider';
import type { TenantAiCredential } from '../../domain/entities/TenantAiCredential';
import type { EncryptedBlob } from '../../domain/contracts/AiRecords';

type KeyColumns = Pick<PrismaAiPlatformProvider, 'apiKeyCiphertext' | 'apiKeyIv' | 'apiKeyTag' | 'keyVersion'>;

/** Prisma ↔ domínio. `toDomain` nunca carrega bytes cifrados; `toBlob`/`fromBlob` sim. */
export class PrismaAiMapper {
  static providerToDomain(raw: PrismaAiPlatformProvider): AiPlatformProvider {
    return {
      id: raw.id,
      kind: raw.kind,
      label: raw.label,
      model: raw.model,
      enabled: raw.enabled,
      priority: raw.priority,
      dailyLimitPerTenant: raw.dailyLimitPerTenant,
      hasKey: raw.apiKeyCiphertext.length > 0,
      baseUrl: raw.kind === 'OPENAI_COMPATIBLE' ? raw.baseUrl : null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  static credentialToDomain(raw: PrismaTenantAiCredential): TenantAiCredential {
    return {
      tenantId: raw.tenantId,
      kind: raw.kind,
      model: raw.model,
      enabled: raw.enabled,
      updatedAt: raw.updatedAt,
    };
  }

  static toBlob(raw: KeyColumns): EncryptedBlob | null {
    if (!raw.apiKeyCiphertext.length) return null;
    return {
      ciphertext: Buffer.from(raw.apiKeyCiphertext),
      iv: Buffer.from(raw.apiKeyIv),
      tag: Buffer.from(raw.apiKeyTag),
      keyVersion: raw.keyVersion,
    };
  }

  static fromBlob(blob: EncryptedBlob): KeyColumns {
    return {
      apiKeyCiphertext: blob.ciphertext,
      apiKeyIv: blob.iv,
      apiKeyTag: blob.tag,
      keyVersion: blob.keyVersion,
    };
  }
}
