import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import { InfrastructureError } from '../../../../shared/errors/InfrastructureError';
import { PrismaAffiliateCredentialMapper as Mapper } from '../mappers/PrismaAffiliateCredentialMapper';
import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type {
  AffiliateCredentialRecord,
  UpsertAffiliateCredentialRecord,
  UpsertAffiliateSessionRecord,
} from '../../domain/contracts/AffiliateCredentialRecords';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { AffiliateCredentialStatus } from '../../domain/enums/AffiliateCredentialStatus';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Dois upserts simultâneos do mesmo (tenant, provider) podem colidir no create (P2002): a
 * segunda tentativa já encontra a linha e vira update. Nenhum erro Prisma cru sobe.
 */
async function withUniqueRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (isUniqueViolation(err)) {
      try {
        return await op();
      } catch (retryErr) {
        throw toInfrastructureError(retryErr);
      }
    }
    throw toInfrastructureError(err);
  }
}

function toInfrastructureError(err: unknown): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return new InfrastructureError('AFFILIATE_CREDENTIAL_PERSISTENCE_FAILED', `Persistence failed (${err.code})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class PrismaAffiliateCredentialRepository implements IAffiliateCredentialRepository {
  async listByTenant(tenantId: string): Promise<AffiliateCredential[]> {
    const rows = await prisma.affiliateCredential.findMany({
      where: { tenantId },
      orderBy: { provider: 'asc' },
    });
    return rows.map(Mapper.toDomain);
  }

  async findByTenantAndProvider(
    tenantId: string,
    provider: AffiliateProvider,
  ): Promise<AffiliateCredentialRecord | null> {
    const raw = await prisma.affiliateCredential.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    return raw ? Mapper.toRecord(raw) : null;
  }

  async findActiveByTenantAndProvider(
    tenantId: string,
    provider: AffiliateProvider,
  ): Promise<AffiliateCredentialRecord | null> {
    const raw = await prisma.affiliateCredential.findFirst({
      where: { tenantId, provider, status: 'ACTIVE', publicIdentifier: { not: null } },
    });
    return raw ? Mapper.toRecord(raw) : null;
  }

  async upsert(input: UpsertAffiliateCredentialRecord): Promise<AffiliateCredential> {
    const secret = input.secret ? Mapper.secretColumns(input.secret) : {};
    const raw = await withUniqueRetry(() =>
      prisma.affiliateCredential.upsert({
        where: { tenantId_provider: { tenantId: input.tenantId, provider: input.provider } },
        create: {
          tenantId: input.tenantId,
          provider: input.provider,
          publicIdentifier: input.publicIdentifier,
          ...secret,
        },
        update: { publicIdentifier: input.publicIdentifier, ...secret },
      }),
    );
    return Mapper.toDomain(raw);
  }

  async upsertSession(input: UpsertAffiliateSessionRecord): Promise<AffiliateCredential> {
    const session = Mapper.sessionColumns(input.session, input.syncedAt);
    const key = { tenantId: input.tenantId, provider: input.provider };

    // (1) Só as colunas de sessão; a linha nasce com a tag da extensão, se houver.
    let raw = await withUniqueRetry(() =>
      prisma.affiliateCredential.upsert({
        where: { tenantId_provider: key },
        create: { ...key, publicIdentifier: input.publicIdentifierIfEmpty ?? null, ...session },
        update: session,
      }),
    );

    // (2) Tag só preenche ID vazio — condição no WHERE, atômica: o painel sempre vence.
    if (input.publicIdentifierIfEmpty && raw.publicIdentifier === null) {
      const { count } = await prisma.affiliateCredential.updateMany({
        where: { ...key, publicIdentifier: null },
        data: { publicIdentifier: input.publicIdentifierIfEmpty },
      });
      if (count > 0) {
        raw = await prisma.affiliateCredential.findUniqueOrThrow({ where: { tenantId_provider: key } });
      }
    }
    return Mapper.toDomain(raw);
  }

  async delete(tenantId: string, provider: AffiliateProvider): Promise<boolean> {
    const { count } = await prisma.affiliateCredential.deleteMany({ where: { tenantId, provider } });
    return count > 0;
  }

  async setStatus(
    tenantId: string,
    provider: AffiliateProvider,
    status: AffiliateCredentialStatus,
  ): Promise<AffiliateCredential | null> {
    const { count } = await prisma.affiliateCredential.updateMany({
      where: { tenantId, provider },
      data: { status },
    });
    if (count === 0) return null;
    const raw = await prisma.affiliateCredential.findFirst({ where: { tenantId, provider } });
    return raw ? Mapper.toDomain(raw) : null;
  }
}
