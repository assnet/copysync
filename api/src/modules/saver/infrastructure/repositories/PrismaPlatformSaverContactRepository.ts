import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { PlatformSaverContact } from '../../domain/entities/SaverEntities';
import type {
  ApplyGroupReadOutcome,
  IPlatformSaverContactRepository,
  SaverContactUsage,
  PlatformSaverContactFilter,
  PlatformSaverContactKey,
  PlatformSaverContactLink,
  PlatformSaverContactRow,
  PlatformSaverTenant,
  PlatformSaverTenantKey,
} from '../../domain/contracts/IPlatformSaverContactRepository';
import type { ContactMerge, ContactUpdate, MergeGroupReadResult } from '../../domain/services/mergeGroupRead';
import { ConcurrentWriteConflictError, NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { SaverItemClaim } from '../../domain/contracts/ISaverExtractionQueue';
import { lockSaverTenant } from './saverTenantLock';
import { PrismaSaverMapper } from '../mappers/PrismaSaverMapper';

type Tx = Prisma.TransactionClient;

/** Lote das escritas em SQL cru (design.md §3). */
export const SAVER_WRITE_BATCH = 500;
const APPLY_TIMEOUT_MS = 60_000;

const chunk = <T>(list: readonly T[], size = SAVER_WRITE_BATCH): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const iso = (d: Date) => d.toISOString();
/** Lote como JSON (`jsonb_to_recordset`): aceita colunas só com NULL, que arrays tipados do driver recusam. */
const rowsJson = (rows: readonly object[]) => JSON.stringify(rows);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Base de contatos da PLATAFORMA (sem `tenantId`, de propósito). Único repositório que lê `saver_contacts`
 * sem passar por vínculo do tenant: só use cases `Platform*` (super admin) e a gravação da extração.
 *
 * `applyGroupRead` (ordem do cabeçalho de `mergeGroupRead`), numa transação:
 * 1. fusões sob `pg_advisory_xact_lock` dos dois ids (vínculos migram de TODOS os tenants; absorvido some);
 * 2. inserts em lotes de 500 ordenados por chave, `ON CONFLICT DO NOTHING`; o que bateu na unicidade (outro
 *    tenant gravou antes) é resolvido pelo telefone, senão pelo LID, e vira atualização;
 * 3. atualizações com trava `FOR UPDATE` em ordem de id (sem deadlock entre tenants); telefone/LID só passam
 *    de vazio para preenchido e só se a chave estiver livre; nome só por valor não vazio;
 * 4. vínculos `ON CONFLICT (groupId, contactId) DO UPDATE`; 5. saídas (`leftAt`).
 */
export class PrismaPlatformSaverContactRepository implements IPlatformSaverContactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByKeys(phones: readonly string[], lids: readonly string[]): Promise<PlatformSaverContact[]> {
    if (phones.length === 0 && lids.length === 0) return [];
    const rows = await this.prisma.saverContact.findMany({
      where: { OR: [{ phone: { in: [...phones] } }, { lid: { in: [...lids] } }] },
    });
    return rows.map(PrismaSaverMapper.contact);
  }

  async list(
    filter: PlatformSaverContactFilter,
    after: PlatformSaverContactKey | null,
    limit: number,
  ): Promise<PlatformSaverContactRow[]> {
    const rows = await this.prisma.$queryRaw<ListSqlRow[]>`
      SELECT c."id", c."phone", c."lid", c."name", c."firstSeenAt", c."lastSeenAt",
        agg.tenant_count, agg.group_count, agg.first_ext, agg.last_ext
      FROM "saver_contacts" c
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT m."tenantId") AS tenant_count, COUNT(*) AS group_count,
          MIN(m."firstExtractedAt") AS first_ext, MAX(m."lastExtractedAt") AS last_ext
        FROM "saver_group_memberships" m WHERE m."contactId" = c."id"
      ) agg ON true
      WHERE true ${searchSql(filter.search)} ${linkFilterSql(filter)}
        ${after ? Prisma.sql`AND (c."lastSeenAt" < ${after.lastSeenAt} OR (c."lastSeenAt" = ${after.lastSeenAt} AND c."id" COLLATE "C" < ${after.id}))` : Prisma.empty}
      ORDER BY c."lastSeenAt" DESC, c."id" COLLATE "C" DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      lid: r.lid,
      name: r.name,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      tenantCount: Number(r.tenant_count ?? 0),
      groupCount: Number(r.group_count ?? 0),
      firstExtractedAt: r.first_ext,
      lastExtractedAt: r.last_ext,
    }));
  }

  async findLinks(contactId: string): Promise<PlatformSaverContactLink[]> {
    const rows = await this.prisma.saverGroupMembership.findMany({
      where: { contactId },
      select: {
        tenantId: true, groupId: true, name: true, isAdmin: true, firstExtractedAt: true, lastExtractedAt: true, leftAt: true,
        group: { select: { name: true } },
        tenant: { select: { name: true } },
      },
      orderBy: [{ lastExtractedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(({ group, tenant, ...r }) => ({ ...r, tenantName: tenant.name, groupName: group.name }));
  }

  async listTenants(after: PlatformSaverTenantKey | null, limit: number): Promise<PlatformSaverTenant[]> {
    // Mesma collation no WHERE e no ORDER BY (keyset estável); `EXISTS` usa `@@index([tenantId, contactId])`.
    return this.prisma.$queryRaw<PlatformSaverTenant[]>`
      SELECT t."id", t."name" FROM "tenants" t
      WHERE EXISTS (SELECT 1 FROM "saver_group_memberships" m WHERE m."tenantId" = t."id")
        ${after ? Prisma.sql`AND (t."name", t."id") > (${after.name}, ${after.id})` : Prisma.empty}
      ORDER BY t."name", t."id"
      LIMIT ${limit}`;
  }

  applyGroupRead(
    tenantId: string,
    groupId: string,
    result: MergeGroupReadResult,
    claim: SaverItemClaim,
    fitsContacts: (usage: SaverContactUsage) => boolean,
  ): Promise<ApplyGroupReadOutcome> {
    return this.applyInTransaction(tenantId, groupId, result, claim, fitsContacts).catch((err: unknown) => {
      throw isWriteRace(err) ? new ConcurrentWriteConflictError('SaverContact') : err;
    });
  }

  private applyInTransaction(
    tenantId: string,
    groupId: string,
    result: MergeGroupReadResult,
    claim: SaverItemClaim,
    fitsContacts: (usage: SaverContactUsage) => boolean,
  ): Promise<ApplyGroupReadOutcome> {
    return this.prisma.$transaction(
      async (tx): Promise<ApplyGroupReadOutcome> => {
        // Trava do tenant primeiro (mesma ordem do pedido de extração). Depois item antes do grupo (mesma
        // ordem de remover: cancela itens, depois marca o grupo). A trava do item segura cancelamento/remoção
        // até o fim; claim perdido ou grupo removido = nada gravado.
        await lockSaverTenant(tx, tenantId);
        const owned = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "saver_extraction_items"
          WHERE "id" = ${claim.itemId} AND "tenantId" = ${tenantId} AND "groupId" = ${groupId}
            AND "status" = 'RUNNING' AND "lockedUntil" IS NOT DISTINCT FROM ${claim.lockedUntil}::timestamp(3)
          FOR UPDATE`;
        if (owned.length === 0) return { status: 'CLAIM_LOST' };
        const group = await tx.$queryRaw<{ id: string; removedAt: Date | null }[]>`
          SELECT "id", "removedAt" FROM "saver_groups" WHERE "id" = ${groupId} AND "tenantId" = ${tenantId} FOR UPDATE`;
        if (group.length === 0) throw new NotFoundError('SaverGroup', groupId);
        if (group[0]!.removedAt) return { status: 'CLAIM_LOST' };
        if (!fitsContacts(await contactUsage(tx, tenantId, result))) return { status: 'LIMIT_REACHED' };

        for (const merge of result.contactMerges) await applyMerge(tx, merge);
        const { insertedIds, created, conflictUpdates } = await applyInserts(tx, result);
        await applyUpdates(tx, [...result.contactUpdates, ...conflictUpdates]);

        const contactIdOf = (ref: MergeGroupReadResult['membershipUpserts'][number]['contact']) =>
          'existingId' in ref ? ref.existingId : insertedIds[ref.newIndex]!;
        await applyMemberships(tx, tenantId, groupId, result, contactIdOf);

        const left = result.markLeft.map((l) => l.contactId);
        if (left.length > 0) {
          await tx.saverGroupMembership.updateMany({
            where: { tenantId, groupId, contactId: { in: left }, leftAt: null },
            data: { leftAt: result.markLeft[0]!.leftAt },
          });
        }
        return { status: 'APPLIED', insertedIds, created };
      },
      { timeout: APPLY_TIMEOUT_MS, maxWait: APPLY_TIMEOUT_MS },
    );
  }
}

/** Uso do teto `saver_contacts` lido sob a trava do tenant (mesma regra de `ISaverMembershipRepository`). */
async function contactUsage(tx: Prisma.TransactionClient, tenantId: string, result: MergeGroupReadResult): Promise<SaverContactUsage> {
  const existingIds = [
    ...new Set(result.membershipUpserts.flatMap((m) => ('existingId' in m.contact ? [m.contact.existingId] : []))),
  ];
  const [row] = await tx.$queryRaw<{ used: bigint; linked: bigint }[]>`
    SELECT COUNT(DISTINCT m."contactId") AS used,
      COUNT(DISTINCT m."contactId") FILTER (WHERE m."contactId" = ANY(${existingIds}::text[])) AS linked
    FROM "saver_group_memberships" m
    JOIN "saver_groups" g ON g."id" = m."groupId" AND g."tenantId" = ${tenantId} AND g."removedAt" IS NULL
    WHERE m."tenantId" = ${tenantId}`;
  const firstLinks = existingIds.length - Number(row?.linked ?? 0);
  return { used: Number(row?.used ?? 0), adding: firstLinks + result.contactInserts.length };
}

/** Prisma: unicidade (P2002), conflito/deadlock (P2034); SQL cru (P2010) com SQLSTATE de unicidade, deadlock ou serialização. */
const RACE_SQLSTATES = new Set(['23505', '40P01', '40001']);
function isWriteRace(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2002' || err.code === 'P2034') return true;
  const sqlState = (err.meta as { code?: unknown } | undefined)?.code;
  return err.code === 'P2010' && typeof sqlState === 'string' && RACE_SQLSTATES.has(sqlState);
}

interface ListSqlRow {
  id: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  tenant_count: bigint | null;
  group_count: bigint | null;
  first_ext: Date | null;
  last_ext: Date | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function searchSql(search: string | null): Prisma.Sql {
  const term = search?.trim();
  if (!term) return Prisma.empty;
  const like = `%${escapeLike(term)}%`;
  // Busca por telefone só quando o termo é número (com máscara): "L3" não casa todo telefone com 3.
  const digits = /^[\d\s().+-]+$/.test(term) ? term.replace(/\D+/g, '') : '';
  return Prisma.sql`AND (c."name" ILIKE ${like} OR c."lid" ILIKE ${like}
    ${digits ? Prisma.sql`OR c."phone" LIKE ${`%${digits}%`}` : Prisma.empty})`;
}

/** Tenant e período filtram pelos vínculos (data e hora da extração), não pelo contato global. */
function linkFilterSql(f: PlatformSaverContactFilter): Prisma.Sql {
  if (!f.tenantId && !f.from && !f.to) return Prisma.empty;
  return Prisma.sql`AND EXISTS (
    SELECT 1 FROM "saver_group_memberships" fm WHERE fm."contactId" = c."id"
      ${f.tenantId ? Prisma.sql`AND fm."tenantId" = ${f.tenantId}` : Prisma.empty}
      ${f.from ? Prisma.sql`AND fm."lastExtractedAt" >= ${f.from}` : Prisma.empty}
      ${f.to ? Prisma.sql`AND fm."lastExtractedAt" < ${f.to}` : Prisma.empty})`;
}

/** Fusão: vínculos do absorvido (de qualquer tenant) vão para o sobrevivente; vínculo duplicado no mesmo grupo é somado. */
async function applyMerge(tx: Tx, { survivorId, absorbedId }: ContactMerge): Promise<void> {
  for (const id of [survivorId, absorbedId].sort(byText)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`saver_contact:${id}`}, 0))`;
  }
  const alive = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "saver_contacts" WHERE "id" = ANY(${[survivorId, absorbedId]}::text[]) ORDER BY "id" COLLATE "C" FOR UPDATE`;
  const ids = new Set(alive.map((r) => r.id));
  if (!ids.has(absorbedId)) return; // outra gravação já fundiu
  if (!ids.has(survivorId)) throw new ConcurrentWriteConflictError('SaverContact');

  await tx.$executeRaw`
    UPDATE "saver_group_memberships" sm SET
      "firstExtractedAt" = LEAST(sm."firstExtractedAt", am."firstExtractedAt"),
      "lastExtractedAt" = GREATEST(sm."lastExtractedAt", am."lastExtractedAt"),
      "name" = CASE WHEN am."lastExtractedAt" > sm."lastExtractedAt" THEN COALESCE(am."name", sm."name") ELSE COALESCE(sm."name", am."name") END,
      "lastExtractionId" = CASE WHEN am."lastExtractedAt" > sm."lastExtractedAt" THEN am."lastExtractionId" ELSE sm."lastExtractionId" END,
      "isAdmin" = sm."isAdmin" OR am."isAdmin",
      "leftAt" = CASE WHEN sm."leftAt" IS NULL OR am."leftAt" IS NULL THEN NULL ELSE GREATEST(sm."leftAt", am."leftAt") END
    FROM "saver_group_memberships" am
    WHERE am."contactId" = ${absorbedId} AND sm."contactId" = ${survivorId} AND sm."groupId" = am."groupId"`;
  await tx.$executeRaw`
    DELETE FROM "saver_group_memberships" am
    WHERE am."contactId" = ${absorbedId}
      AND EXISTS (SELECT 1 FROM "saver_group_memberships" sm WHERE sm."contactId" = ${survivorId} AND sm."groupId" = am."groupId")`;
  await tx.$executeRaw`UPDATE "saver_group_memberships" SET "contactId" = ${survivorId} WHERE "contactId" = ${absorbedId}`;
  await tx.$executeRaw`DELETE FROM "saver_contacts" WHERE "id" = ${absorbedId}`;
}

async function applyInserts(
  tx: Tx,
  result: MergeGroupReadResult,
): Promise<{ insertedIds: string[]; created: number; conflictUpdates: ContactUpdate[] }> {
  const insertedIds: string[] = result.contactInserts.map(() => randomUUID());
  const order = result.contactInserts
    .map((c, index) => ({ ...c, index }))
    .sort((a, b) => byText(a.phone ?? '￿', b.phone ?? '￿') || byText(a.lid ?? '', b.lid ?? ''));
  const createdIds = new Set<string>();
  for (const part of chunk(order)) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "saver_contacts" ("id", "phone", "lid", "name", "firstSeenAt", "lastSeenAt")
      SELECT u."id", u."phone", u."lid", u."name", u."firstSeenAt" AT TIME ZONE 'UTC', u."lastSeenAt" AT TIME ZONE 'UTC'
      FROM jsonb_to_recordset(${rowsJson(part.map((c) => ({
        id: insertedIds[c.index]!, phone: c.phone, lid: c.lid, name: c.name, firstSeenAt: iso(c.firstSeenAt), lastSeenAt: iso(c.lastSeenAt),
      })))}::jsonb) AS u("id" text, "phone" text, "lid" text, "name" text, "firstSeenAt" timestamptz, "lastSeenAt" timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING "id"`;
    for (const r of rows) createdIds.add(r.id);
  }

  const conflicted = order.filter((c) => !createdIds.has(insertedIds[c.index]!));
  const conflictUpdates: ContactUpdate[] = [];
  if (conflicted.length > 0) {
    const phones = conflicted.flatMap((c) => (c.phone ? [c.phone] : []));
    const lids = conflicted.flatMap((c) => (c.lid ? [c.lid] : []));
    const existing = await tx.saverContact.findMany({
      where: { OR: [{ phone: { in: phones } }, { lid: { in: lids } }] },
      select: { id: true, phone: true, lid: true },
    });
    const byPhone = new Map(existing.filter((e) => e.phone).map((e) => [e.phone!, e.id]));
    const byLid = new Map(existing.filter((e) => e.lid).map((e) => [e.lid!, e.id]));
    for (const c of conflicted) {
      // Telefone é o dado principal; sem ele, o LID identifica.
      const id = (c.phone && byPhone.get(c.phone)) || (c.lid && byLid.get(c.lid)) || null;
      if (!id) throw new ConcurrentWriteConflictError('SaverContact');
      insertedIds[c.index] = id;
      conflictUpdates.push({
        id,
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.lid ? { lid: c.lid } : {}),
        ...(c.name ? { name: c.name } : {}),
        lastSeenAt: c.lastSeenAt,
      });
    }
  }
  return { insertedIds, created: createdIds.size, conflictUpdates };
}

async function applyUpdates(tx: Tx, updates: readonly ContactUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const merged = new Map<string, ContactUpdate>();
  for (const u of updates) {
    const prev = merged.get(u.id);
    merged.set(
      u.id,
      prev
        ? {
            id: u.id,
            phone: prev.phone ?? u.phone,
            lid: prev.lid ?? u.lid,
            name: u.name ?? prev.name,
            firstSeenAt: prev.firstSeenAt ?? u.firstSeenAt,
            lastSeenAt: prev.lastSeenAt > u.lastSeenAt ? prev.lastSeenAt : u.lastSeenAt,
          }
        : u,
    );
  }
  const list = [...merged.values()].sort((a, b) => byText(a.id, b.id));
  for (const part of chunk(list)) {
    const ids = part.map((u) => u.id);
    await tx.$queryRaw`SELECT "id" FROM "saver_contacts" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" COLLATE "C" FOR UPDATE`;
    await tx.$executeRaw`
      UPDATE "saver_contacts" c SET
        "phone" = CASE WHEN c."phone" IS NULL AND u."phone" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "saver_contacts" o WHERE o."phone" = u."phone") THEN u."phone" ELSE c."phone" END,
        "lid" = CASE WHEN c."lid" IS NULL AND u."lid" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "saver_contacts" o WHERE o."lid" = u."lid") THEN u."lid" ELSE c."lid" END,
        "name" = COALESCE(NULLIF(BTRIM(u."name"), ''), c."name"),
        "firstSeenAt" = LEAST(c."firstSeenAt", COALESCE(u."firstSeenAt", c."firstSeenAt")),
        "lastSeenAt" = GREATEST(c."lastSeenAt", u."lastSeenAt")
      FROM (
        SELECT r."id", r."phone", r."lid", r."name",
          r."firstSeenAt" AT TIME ZONE 'UTC' AS "firstSeenAt", r."lastSeenAt" AT TIME ZONE 'UTC' AS "lastSeenAt"
        FROM jsonb_to_recordset(${rowsJson(part.map((u) => ({
          id: u.id, phone: u.phone ?? null, lid: u.lid ?? null, name: u.name ?? null,
          firstSeenAt: u.firstSeenAt ? iso(u.firstSeenAt) : null, lastSeenAt: iso(u.lastSeenAt),
        })))}::jsonb) AS r("id" text, "phone" text, "lid" text, "name" text, "firstSeenAt" timestamptz, "lastSeenAt" timestamptz)
      ) u
      WHERE c."id" = u."id"`;
  }
}

async function applyMemberships(
  tx: Tx,
  tenantId: string,
  groupId: string,
  result: MergeGroupReadResult,
  contactIdOf: (ref: MergeGroupReadResult['membershipUpserts'][number]['contact']) => string,
): Promise<void> {
  // Dois inserts podem cair no mesmo contato (conflito resolvido): uma linha por contato no lote.
  const byContact = new Map<string, MergeGroupReadResult['membershipUpserts'][number] & { contactId: string }>();
  for (const m of result.membershipUpserts) {
    const contactId = contactIdOf(m.contact);
    const prev = byContact.get(contactId);
    if (prev) {
      prev.isAdmin = prev.isAdmin || m.isAdmin;
      prev.name = prev.name ?? m.name;
      if (m.firstExtractedAt < prev.firstExtractedAt) prev.firstExtractedAt = m.firstExtractedAt;
    } else {
      byContact.set(contactId, { ...m, contactId });
    }
  }
  const list = [...byContact.values()].sort((a, b) => byText(a.contactId, b.contactId));
  for (const part of chunk(list)) {
    await tx.$executeRaw`
      INSERT INTO "saver_group_memberships" AS m
        ("id", "tenantId", "groupId", "contactId", "name", "isAdmin", "firstExtractedAt", "lastExtractedAt", "lastExtractionId", "leftAt")
      SELECT u."id", ${tenantId}, ${groupId}, u."contactId", u."name", u."isAdmin",
        u."first" AT TIME ZONE 'UTC', u."last" AT TIME ZONE 'UTC', u."extractionId", NULL
      FROM jsonb_to_recordset(${rowsJson(part.map((m) => ({
        id: randomUUID(), contactId: m.contactId, name: m.name, isAdmin: m.isAdmin,
        first: iso(m.firstExtractedAt), last: iso(m.lastExtractedAt), extractionId: m.lastExtractionId,
      })))}::jsonb) AS u("id" text, "contactId" text, "name" text, "isAdmin" boolean, "first" timestamptz, "last" timestamptz, "extractionId" text)
      ON CONFLICT ("groupId", "contactId") DO UPDATE SET
        "name" = COALESCE(EXCLUDED."name", m."name"),
        "isAdmin" = EXCLUDED."isAdmin",
        "firstExtractedAt" = LEAST(m."firstExtractedAt", EXCLUDED."firstExtractedAt"),
        "lastExtractedAt" = EXCLUDED."lastExtractedAt",
        "lastExtractionId" = EXCLUDED."lastExtractionId",
        "leftAt" = NULL`;
  }
}
