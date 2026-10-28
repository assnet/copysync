import type { AffiliateCredential } from '../entities/AffiliateCredential';
import type { AffiliateProvider } from '../enums/AffiliateProvider';
import type { AffiliateCredentialStatus } from '../enums/AffiliateCredentialStatus';
import type {
  AffiliateCredentialRecord,
  UpsertAffiliateCredentialRecord,
  UpsertAffiliateSessionRecord,
} from './AffiliateCredentialRecords';

/** Persistência de credenciais de afiliado. Toda operação é escopada por `tenantId`. */
export interface IAffiliateCredentialRepository {
  listByTenant(tenantId: string): Promise<AffiliateCredential[]>;
  /** Inclui os blobs cifrados. */
  findByTenantAndProvider(
    tenantId: string,
    provider: AffiliateProvider,
  ): Promise<AffiliateCredentialRecord | null>;
  /** Ignora `INACTIVE` e linhas sem `publicIdentifier` (só sessão). */
  findActiveByTenantAndProvider(
    tenantId: string,
    provider: AffiliateProvider,
  ): Promise<AffiliateCredentialRecord | null>;
  /** Painel: grava público/secreto, preserva colunas de sessão. */
  upsert(input: UpsertAffiliateCredentialRecord): Promise<AffiliateCredential>;
  /** Extensão: grava sessão; ID público só se a linha não tiver. */
  upsertSession(input: UpsertAffiliateSessionRecord): Promise<AffiliateCredential>;
  /** false = não existia. */
  delete(tenantId: string, provider: AffiliateProvider): Promise<boolean>;
  /** Zera só as colunas de sessão; ID público e secreto ficam. false = não havia sessão. */
  clearSession(tenantId: string, provider: AffiliateProvider): Promise<boolean>;
  /** Loja recusou a credencial: grava `rejectedAt`/`rejectedCode`. No-op se a linha sumiu. */
  markRejected(tenantId: string, provider: AffiliateProvider, code: string, at: Date): Promise<void>;
  /** null = não existia. */
  setStatus(
    tenantId: string,
    provider: AffiliateProvider,
    status: AffiliateCredentialStatus,
  ): Promise<AffiliateCredential | null>;
}
