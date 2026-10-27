import type { AffiliateCredential as PrismaAffiliateCredential } from '@prisma/client';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import type {
  AffiliateCredentialRecord,
  EncryptedBlob,
} from '../../domain/contracts/AffiliateCredentialRecords';

function secretBlob(raw: PrismaAffiliateCredential): EncryptedBlob | null {
  if (!raw.secretCiphertext || !raw.secretIv || !raw.secretTag) return null;
  return {
    ciphertext: Buffer.from(raw.secretCiphertext),
    iv: Buffer.from(raw.secretIv),
    tag: Buffer.from(raw.secretTag),
    keyVersion: raw.keyVersion,
  };
}

function sessionBlob(raw: PrismaAffiliateCredential): EncryptedBlob | null {
  if (!raw.sessionCiphertext || !raw.sessionIv || !raw.sessionTag || raw.sessionKeyVersion == null) {
    return null;
  }
  return {
    ciphertext: Buffer.from(raw.sessionCiphertext),
    iv: Buffer.from(raw.sessionIv),
    tag: Buffer.from(raw.sessionTag),
    keyVersion: raw.sessionKeyVersion,
  };
}

/** Prisma ↔ domínio. `toDomain` nunca carrega bytes cifrados; `toRecord` carrega. */
export class PrismaAffiliateCredentialMapper {
  static toDomain(raw: PrismaAffiliateCredential): AffiliateCredential {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      provider: raw.provider,
      publicIdentifier: raw.publicIdentifier,
      hasSecret: secretBlob(raw) !== null,
      hasSession: sessionBlob(raw) !== null,
      sessionSyncedAt: raw.sessionSyncedAt,
      sessionInvalidAt: raw.sessionInvalidAt,
      sessionAccountHash: raw.sessionAccountHash,
      sessionAccountKeyVersion: raw.sessionAccountKeyVersion,
      status: raw.status,
      lastValidatedAt: raw.lastValidatedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  static toRecord(raw: PrismaAffiliateCredential): AffiliateCredentialRecord {
    return {
      ...PrismaAffiliateCredentialMapper.toDomain(raw),
      secret: secretBlob(raw),
      session: sessionBlob(raw),
    };
  }

  static secretColumns(blob: EncryptedBlob) {
    return {
      secretCiphertext: blob.ciphertext,
      secretIv: blob.iv,
      secretTag: blob.tag,
      keyVersion: blob.keyVersion,
    };
  }

  static sessionColumns(blob: EncryptedBlob, syncedAt: Date) {
    return {
      sessionCiphertext: blob.ciphertext,
      sessionIv: blob.iv,
      sessionTag: blob.tag,
      sessionKeyVersion: blob.keyVersion,
      sessionSyncedAt: syncedAt,
    };
  }
}
