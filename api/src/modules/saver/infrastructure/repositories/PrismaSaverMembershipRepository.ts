import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ISaverMembershipRepository,
  SaverMembershipExportCount,
  SaverMembershipExportQuery,
  SaverMembershipExportRow,
} from '../../domain/contracts/ISaverMembershipRepository';
import type { GroupMembershipState } from '../../domain/services/mergeGroupRead';

/**
 * Caminho do TENANT até os dados: tudo parte de `saver_group_memberships` com `tenantId` e grupo do mesmo
 * tenant não removido. Do contato global só saem `phone`/`lid`; nome é sempre o do vínculo (SAVER-46),
 * nunca `saver_contacts.name`.
 */
export class PrismaSaverMembershipRepository implements ISaverMembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listGroupMemberships(tenantId: string, groupId: string): Promise<GroupMembershipState[]> {
    return this.prisma.saverGroupMembership.findMany({
      where: { tenantId, groupId },
      select: { contactId: true, name: true, isAdmin: true, firstExtractedAt: true, lastExtractedAt: true, leftAt: true },
    });
  }

  async countDistinctContacts(tenantId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT m."contactId") AS n
      FROM "saver_group_memberships" m
      JOIN "saver_groups" g ON g."id" = m."groupId" AND g."tenantId" = ${tenantId} AND g."removedAt" IS NULL
      WHERE m."tenantId" = ${tenantId}`;
    return Number(row?.n ?? 0);
  }

  async countContactsWithoutTenantLink(tenantId: string, contactIds: readonly string[]): Promise<number> {
    const ids = [...new Set(contactIds)];
    if (ids.length === 0) return 0;
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT m."contactId") AS n
      FROM "saver_group_memberships" m
      JOIN "saver_groups" g ON g."id" = m."groupId" AND g."tenantId" = ${tenantId} AND g."removedAt" IS NULL
      WHERE m."tenantId" = ${tenantId} AND m."contactId" = ANY(${ids}::text[])`;
    return ids.length - Number(row?.n ?? 0);
  }

  async countForExport(query: SaverMembershipExportQuery): Promise<SaverMembershipExportCount> {
    if (query.groupIds.length === 0) return { total: 0, withPhone: 0, lidOnly: 0 };
    const rows = query.onePerGroup
      ? Prisma.sql`SELECT c."phone" FROM ${this.from(query)}`
      : Prisma.sql`SELECT c."phone" FROM ${this.from(query)} GROUP BY m."contactId", c."phone"`;
    const [row] = await this.prisma.$queryRaw<{ total: bigint; with_phone: bigint }[]>`
      SELECT COUNT(*) AS total, COUNT(r."phone") AS with_phone FROM (${rows}) r`;
    const total = Number(row?.total ?? 0);
    const withPhone = Number(row?.with_phone ?? 0);
    return { total, withPhone, lidOnly: total - withPhone };
  }

  /** Keyset por `contactId` (uma linha por contato) ou por vínculo (`onePerGroup`), em lotes. */
  async *exportBatches(query: SaverMembershipExportQuery, batchSize: number): AsyncIterable<SaverMembershipExportRow[]> {
    if (query.groupIds.length === 0) return;
    let after = '';
    for (;;) {
      const rows = query.onePerGroup ? await this.pagePerGroup(query, after, batchSize) : await this.pagePerContact(query, after, batchSize);
      if (rows.length === 0) return;
      after = rows[rows.length - 1]!.key;
      yield rows.map(({ key: _key, ...row }) => row);
      if (rows.length < batchSize) return;
    }
  }

  private from(q: SaverMembershipExportQuery): Prisma.Sql {
    return Prisma.sql`"saver_group_memberships" m
      JOIN "saver_groups" g ON g."id" = m."groupId" AND g."tenantId" = ${q.tenantId} AND g."removedAt" IS NULL
      JOIN "saver_contacts" c ON c."id" = m."contactId"
      WHERE m."tenantId" = ${q.tenantId} AND m."groupId" = ANY(${[...q.groupIds]}::text[])
        ${q.onlyActive ? Prisma.sql`AND m."leftAt" IS NULL` : Prisma.empty}
        ${q.excludeAdmins ? Prisma.sql`AND m."isAdmin" = false` : Prisma.empty}
        ${q.onlyWithPhone ? Prisma.sql`AND c."phone" IS NOT NULL` : Prisma.empty}`;
  }

  private async pagePerContact(
    q: SaverMembershipExportQuery,
    after: string,
    limit: number,
  ): Promise<(SaverMembershipExportRow & { key: string })[]> {
    const rows = await this.prisma.$queryRaw<ExportSqlRow[]>`
      SELECT m."contactId" AS key, m."contactId", c."phone", c."lid",
        (ARRAY_AGG(m."name" ORDER BY m."lastExtractedAt" DESC) FILTER (WHERE m."name" IS NOT NULL))[1] AS name,
        BOOL_OR(m."isAdmin") AS "isAdmin", BOOL_OR(m."leftAt" IS NULL) AS active,
        MAX(m."lastExtractedAt") AS "extractedAt", NULL::text AS "groupName"
      FROM ${this.from(q)} AND m."contactId" COLLATE "C" > ${after}
      GROUP BY m."contactId", c."phone", c."lid"
      ORDER BY m."contactId" COLLATE "C"
      LIMIT ${limit}`;
    return rows.map(toExportRow);
  }

  private async pagePerGroup(
    q: SaverMembershipExportQuery,
    after: string,
    limit: number,
  ): Promise<(SaverMembershipExportRow & { key: string })[]> {
    const rows = await this.prisma.$queryRaw<ExportSqlRow[]>`
      SELECT m."id" AS key, m."contactId", c."phone", c."lid", m."name", m."isAdmin",
        (m."leftAt" IS NULL) AS active, m."lastExtractedAt" AS "extractedAt", g."name" AS "groupName"
      FROM ${this.from(q)} AND m."id" COLLATE "C" > ${after}
      ORDER BY m."id" COLLATE "C"
      LIMIT ${limit}`;
    return rows.map(toExportRow);
  }
}

interface ExportSqlRow {
  key: string;
  contactId: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  isAdmin: boolean;
  active: boolean;
  extractedAt: Date;
  groupName: string | null;
}

function toExportRow(r: ExportSqlRow): SaverMembershipExportRow & { key: string } {
  return {
    key: r.key,
    contactId: r.contactId,
    name: r.name,
    phone: r.phone,
    lid: r.lid,
    isAdmin: r.isAdmin,
    active: r.active,
    extractedAt: r.extractedAt,
    groupName: r.groupName,
  };
}
