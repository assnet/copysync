import type { TenantAiCredential } from '../entities/TenantAiCredential';
import type { EncryptedBlob, UpsertTenantAiCredentialRecord } from './AiRecords';

export interface ITenantAiCredentialRepository {
  find(tenantId: string): Promise<TenantAiCredential | null>;
  findKey(tenantId: string): Promise<EncryptedBlob | null>;
  /** Criação exige `apiKey`; o use case garante isso. */
  upsert(record: UpsertTenantAiCredentialRecord): Promise<TenantAiCredential>;
  /** false se não existe. */
  delete(tenantId: string): Promise<boolean>;
}
