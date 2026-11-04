import type { AffiliateCredential } from '../entities/AffiliateCredential';
import type { AffiliateProvider } from '../enums/AffiliateProvider';
import type { EncryptedBlob } from '../../../../shared/security/ISecretCipher';

export type { EncryptedBlob };

/** Credencial com os blobs cifrados — só repositório e use cases que decifram veem isto. */
export type AffiliateCredentialRecord = AffiliateCredential & {
  secret: EncryptedBlob | null;
  session: EncryptedBlob | null;
};

/** Gravação pelo painel. `secret` ausente = mantém o atual. Colunas de sessão nunca mudam aqui. */
export interface UpsertAffiliateCredentialRecord {
  tenantId: string;
  provider: AffiliateProvider;
  publicIdentifier: string;
  secret?: EncryptedBlob;
  /** true = o que foi recusado mudou (secret/ID novo): zera `rejectedAt`/`rejectedCode`. Ausente = mantém. */
  clearRejection?: boolean;
}

/**
 * Gravação pela extensão. `publicIdentifierIfEmpty` só preenche linha sem ID — o valor do
 * painel sempre vence.
 */
export interface UpsertAffiliateSessionRecord {
  tenantId: string;
  provider: AffiliateProvider;
  session: EncryptedBlob;
  publicIdentifierIfEmpty?: string;
  syncedAt: Date;
  /** true = loja aceitou a sessão agora (ou token novo sem checagem): zera a rejeição. */
  clearRejection?: boolean;
  /** Loja recusou a sessão na checagem do sync: grava a rejeição. Exclusivo com `clearRejection`. */
  rejectWith?: { at: Date; code: string };
}
