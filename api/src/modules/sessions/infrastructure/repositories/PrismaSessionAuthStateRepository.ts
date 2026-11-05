import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type {
  ISessionAuthStateRepository,
  SessionAuthKeyBatch,
  SessionAuthStateRecord,
  SessionAuthStateUpsertData,
  VersionedAuthKeys,
  WriteKeysResult,
} from '../../domain/contracts/ISessionAuthStateRepository';

/** Chaves por `createMany`/`update` no lote (um flush típico tem 1–20 chaves; sync, centenas). */
const WRITE_CHUNK = 200;

export class PrismaSessionAuthStateRepository implements ISessionAuthStateRepository {
  async findBySessionId(sessionId: string): Promise<SessionAuthStateRecord | null> {
    const raw = await prisma.sessionAuthState.findUnique({ where: { sessionId } });
    if (!raw) return null;
    return {
      sessionId: raw.sessionId,
      tenantId: raw.tenantId,
      provider: raw.provider,
      statePayload: raw.statePayload,
      version: raw.version,
    };
  }

  async upsert(data: SessionAuthStateUpsertData): Promise<void> {
    await prisma.sessionAuthState.upsert({
      where: { sessionId: data.sessionId },
      create: {
        sessionId: data.sessionId,
        tenantId: data.tenantId,
        provider: data.provider,
        statePayload: data.statePayload as Prisma.InputJsonValue,
        version: 0,
      },
      update: {
        statePayload: data.statePayload as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
  }

  async findKey(sessionId: string, key: string): Promise<unknown | null> {
    const row = await prisma.sessionAuthKey.findUnique({
      where: { sessionId_key: { sessionId, key } },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  async findAllKeys(sessionId: string): Promise<Record<string, unknown>> {
    const rows = await prisma.sessionAuthKey.findMany({ where: { sessionId }, select: { key: true, value: true } });
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /** Snapshot único (REPEATABLE READ): chaves e versão nunca vêm de flushes diferentes. */
  async findAllKeysVersioned(sessionId: string): Promise<VersionedAuthKeys> {
    const [state, rows] = await prisma.$transaction(
      [
        prisma.sessionAuthState.findUnique({ where: { sessionId }, select: { version: true } }),
        prisma.sessionAuthKey.findMany({ where: { sessionId }, select: { key: true, value: true } }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const keys: Record<string, unknown> = {};
    for (const r of rows) keys[r.key] = r.value;
    return { keys, version: state?.version ?? null };
  }

  /**
   * `INSERT … ON CONFLICT DO UPDATE` em lote (SQL cru: o Prisma não tem upsertMany). Tudo numa
   * transação com a linha-mãe: ou o flush inteiro entra, ou nada.
   */
  async writeKeys(batch: SessionAuthKeyBatch): Promise<WriteKeysResult> {
    const entries = Object.entries(batch.upserts);
    const { sessionId, tenantId, provider, expectedVersion } = batch;
    if (entries.length === 0 && batch.deletes.length === 0) {
      return { ok: true, version: typeof expectedVersion === 'number' ? expectedVersion : null };
    }

    return prisma.$transaction(async (tx): Promise<WriteKeysResult> => {
      let version: number;
      if (expectedVersion === undefined) {
        // Sem CAS: comportamento de antes (Telegram, migração legada)
        ({ version } = await tx.sessionAuthState.upsert({
          where: { sessionId },
          create: { sessionId, tenantId, provider, statePayload: {}, version: 0 },
          update: { version: { increment: 1 } },
          select: { version: true },
        }));
      } else {
        // CAS antes das chaves: a linha fica travada até o commit; zero linhas = outro dono
        const rows = expectedVersion === null
          ? await tx.$queryRaw<{ version: number }[]>`
              INSERT INTO "session_auth_states" ("id", "sessionId", "tenantId", "provider", "statePayload", "version", "updatedAt")
              VALUES (gen_random_uuid()::text, ${sessionId}, ${tenantId}, ${provider}, '{}'::jsonb, 0, now())
              ON CONFLICT ("sessionId") DO NOTHING
              RETURNING "version"`
          : await tx.$queryRaw<{ version: number }[]>`
              UPDATE "session_auth_states" SET "version" = "version" + 1, "updatedAt" = now()
              WHERE "sessionId" = ${sessionId} AND "version" = ${expectedVersion}
              RETURNING "version"`;
        if (rows.length === 0) return { ok: false, reason: 'VERSION_CONFLICT' };
        version = rows[0]!.version;
      }
      for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
        const chunk = entries.slice(i, i + WRITE_CHUNK);
        const values = chunk.map(([key, value]) => Prisma.sql`(${sessionId}, ${key}, ${JSON.stringify(value)}::jsonb, now())`);
        await tx.$executeRaw`
          INSERT INTO "session_auth_keys" ("sessionId", "key", "value", "updatedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("sessionId", "key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`;
      }
      if (batch.deletes.length > 0) {
        await tx.sessionAuthKey.deleteMany({ where: { sessionId, key: { in: batch.deletes } } });
      }
      return { ok: true, version };
    }, { maxWait: 10_000, timeout: 30_000 }); // migração de blob grande/sync passa do padrão de 5 s
  }

  async clearCredentials(sessionId: string): Promise<void> {
    await prisma.$transaction([
      prisma.sessionAuthKey.deleteMany({ where: { sessionId } }),
      prisma.sessionAuthState.updateMany({
        where: { sessionId },
        data: { statePayload: {}, version: { increment: 1 } },
      }),
    ]);
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    // deleteMany — silently no-ops when record does not exist; chaves caem pelo cascade da sessão,
    // mas a linha-mãe pode sobreviver à sessão (RESTRICT no tenant): apaga as duas
    await prisma.$transaction([
      prisma.sessionAuthKey.deleteMany({ where: { sessionId } }),
      prisma.sessionAuthState.deleteMany({ where: { sessionId } }),
    ]);
  }
}
