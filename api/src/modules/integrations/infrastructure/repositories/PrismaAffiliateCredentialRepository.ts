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

const REJECTION_CLEARED = { rejectedAt: null, rejectedCode: null } as const;

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
          rejectedAt: null,
          rejectedCode: null,
        },
        // Rejeição só zera quando o que foi recusado mudou (decisão do use case)
        update: { publicIdentifier: input.publicIdentifier, ...secret, ...(input.clearRejection ? REJECTION_CLEARED : {}) },
      }),
    );
    return Mapper.toDomain(raw);
  }

  async upsertSession(input: UpsertAffiliateSessionRecord): Promise<AffiliateCredential> {
    const session = Mapper.sessionColumns(input.session, input.syncedAt);
    const key = { tenantId: input.tenantId, provider: input.provider };
    const rejection = input.rejectWith
      ? { rejectedAt: input.rejectWith.at, rejectedCode: input.rejectWith.code }
      : input.clearRejection ? REJECTION_CLEARED : {};

    // ID que segue a sessão (Shein): substitui o atual no create e no update.
    const override = input.publicIdentifierOverride ? { publicIdentifier: input.publicIdentifierOverride } : {};

    // Lista vazia = leitura não confiável (conta do ML sempre tem etiqueta): não toca nas colunas.
    const account = input.accountIdentifiers?.length ? input.accountIdentifiers : null;

    // Etiqueta em uso informada pelo sync, na grafia da conta; fora da lista = nenhuma.
    const tag = input.publicIdentifierIfEmpty?.toLowerCase();
    const inUse = (tag && account?.find((a) => a.toLowerCase() === tag)) || null;
    let primaryReplaced = false;

    // (1) Colunas de sessão (+ lista da conta); a linha nasce com a tag da extensão, se houver.
    // Com lista, a poda das vinculadas e a troca da principal que sumiu da conta vão na mesma
    // transação e leem a coluna recém-gravada.
    let raw = await withUniqueRetry(() =>
      prisma.$transaction(async (tx) => {
        const row = await tx.affiliateCredential.upsert({
          where: { tenantId_provider: key },
          create: {
            ...key,
            publicIdentifier: input.publicIdentifierOverride ?? input.publicIdentifierIfEmpty ?? null,
            ...session,
            ...REJECTION_CLEARED,
            ...rejection,
            ...(account && { accountIdentifiers: account }),
          },
          update: { ...session, ...rejection, ...override, ...(account && { accountIdentifiers: account }) },
        });
        if (!account) return row;
        await tx.$executeRaw`
          UPDATE "affiliate_credentials" SET "linkedIdentifiers" = ARRAY(
            SELECT l FROM unnest("linkedIdentifiers") WITH ORDINALITY AS t(l, i)
            WHERE lower(l) IN (SELECT lower(a) FROM unnest("accountIdentifiers") AS a)
            ORDER BY i
          )::text[]
          WHERE "id" = ${row.id}`;
        // Principal que deixou de existir na conta (troca de conta): vira a em uso ou nenhuma.
        primaryReplaced = !input.publicIdentifierOverride && (await tx.$executeRaw`
          UPDATE "affiliate_credentials" SET "publicIdentifier" = ${inUse}
          WHERE "id" = ${row.id} AND "publicIdentifier" IS NOT NULL
            AND lower("publicIdentifier") NOT IN (SELECT lower(a) FROM unnest("accountIdentifiers") AS a)`) > 0;
        return tx.affiliateCredential.findUniqueOrThrow({ where: { id: row.id } });
      }),
    );

    // (2) Tag só preenche ID vazio — condição no WHERE, atômica: o painel sempre vence.
    // Principal recém-trocada já decidiu (tag fora da conta não entra).
    if (!input.publicIdentifierOverride && !primaryReplaced && input.publicIdentifierIfEmpty && raw.publicIdentifier === null) {
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

  async clearSession(tenantId: string, provider: AffiliateProvider): Promise<boolean> {
    const { count } = await prisma.affiliateCredential.updateMany({
      where: { tenantId, provider, sessionCiphertext: { not: null } },
      data: {
        sessionCiphertext: null,
        sessionIv: null,
        sessionTag: null,
        sessionKeyVersion: null,
        sessionSyncedAt: null,
        sessionInvalidAt: null,
        sessionAccountHash: null,
        sessionAccountKeyVersion: null,
        ...Mapper.clearedIdentifierColumns(),
        // Sem sessão = "não conectado": a rejeição (hoje só nasce com sessão, ML) sai junto
        ...REJECTION_CLEARED,
      },
    });
    return count > 0;
  }

  async setIdentifiers(
    tenantId: string,
    provider: AffiliateProvider,
    primary: string,
    linked: string[],
  ): Promise<AffiliateCredential | 'ACCOUNT_CHANGED' | null> {
    // CAS contra um sync no meio: `hasEvery` compara exato, então os valores são a grafia da conta.
    const { count } = await prisma.affiliateCredential.updateMany({
      where: { tenantId, provider, accountIdentifiers: { hasEvery: [primary, ...linked] } },
      data: { publicIdentifier: primary, linkedIdentifiers: linked },
    });
    const raw = await prisma.affiliateCredential.findFirst({ where: { tenantId, provider } });
    if (!raw) return null;
    return count === 0 ? 'ACCOUNT_CHANGED' : Mapper.toDomain(raw);
  }

  /** `updateMany`: linha apagada no meio vira no-op, nunca P2025. */
  async markRejected(tenantId: string, provider: AffiliateProvider, code: string, at: Date): Promise<void> {
    await prisma.affiliateCredential.updateMany({
      where: { tenantId, provider },
      data: { rejectedAt: at, rejectedCode: code },
    });
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
