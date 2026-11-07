import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AttributedStoreClick,
  IExtensionLifecycleRepository,
  LifecycleEventRecord,
  LifecycleWrite,
} from '../../domain/contracts/IExtensionLifecycleRepository';
import { LIFECYCLE_EVENT } from '../../domain/lifecycleEvents';

type Tx = Prisma.TransactionClient;

const isKnown = (err: unknown, ...codes: string[]): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && codes.includes(err.code);

export class PrismaExtensionLifecycleRepository implements IExtensionLifecycleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(write: LifecycleWrite): Promise<{ created: boolean }> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.insertEvent(tx, write.event);
        if (write.outbox) await this.enqueue(tx, write.event.installationId, write.outbox);
      });
      return { created: true };
    } catch (err) {
      // P2002: repetido (idempotente). P2003: instalação desconhecida — rota pública descarta.
      if (isKnown(err, 'P2002', 'P2003')) return { created: false };
      throw err;
    }
  }

  async recordStoreClick(write: LifecycleWrite & { dedupeSince: Date }): Promise<{ recorded: boolean; id: string | null }> {
    const userId = write.event.userId;
    if (!userId) throw new Error('store click requires userId');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ext-store-click:${userId}`}))`;
      const recent = await tx.extensionLifecycleEvent.findFirst({
        where: { userId, type: LIFECYCLE_EVENT.STORE_CLICK, occurredAt: { gte: write.dedupeSince } },
        select: { id: true },
      });
      if (recent) return { recorded: false, id: recent.id };
      const id = await this.insertEvent(tx, write.event);
      if (write.outbox) await this.enqueue(tx, null, write.outbox);
      return { recorded: true, id };
    });
  }

  async attributeStoreClick(userId: string, installationId: string, since: Date): Promise<AttributedStoreClick | null> {
    const click = await this.prisma.extensionLifecycleEvent.findFirst({
      where: { userId, type: LIFECYCLE_EVENT.STORE_CLICK, installationId: null, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, occurredAt: true },
    });
    if (!click) return null;
    // Condicional: dois vínculos simultâneos não levam o mesmo clique.
    const { count } = await this.prisma.extensionLifecycleEvent.updateMany({
      where: { id: click.id, installationId: null },
      data: { installationId },
    });
    return count === 1 ? click : null;
  }

  async findClientKeyForTenant(tenantId: string): Promise<string | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { billingCustomerId: true } });
    return row?.billingCustomerId ?? null;
  }

  async findTenantForInstallation(installationId: string): Promise<string | null> {
    const row = await this.prisma.extensionSession.findFirst({
      where: { installationId },
      orderBy: { lastSeenAt: 'desc' },
      select: { mlTenantId: true },
    });
    return row?.mlTenantId ?? null;
  }

  async upsertUninstallFeedback(input: { installationId: string; reasons: string[]; comment: string | null; version: string | null }): Promise<boolean> {
    try {
      await this.prisma.extensionUninstallFeedback.upsert({
        where: { installationId: input.installationId },
        create: input,
        update: { reasons: input.reasons, comment: input.comment, version: input.version },
      });
      return true;
    } catch (err) {
      if (isKnown(err, 'P2003')) return false; // instalação desconhecida
      throw err;
    }
  }

  private async insertEvent(tx: Tx, event: LifecycleEventRecord): Promise<string> {
    const row = await tx.extensionLifecycleEvent.create({
      data: {
        installationId: event.installationId,
        type: event.type,
        version: event.version,
        channel: event.channel,
        dedupeKey: event.dedupeKey,
        occurredAt: event.occurredAt,
        userId: event.userId ?? null,
        tenantId: event.tenantId ?? null,
        source: event.source ?? null,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** `seq` por `clientKey` pelo contador `hub_outbox_sequences`, na mesma transação do evento. */
  private async enqueue(tx: Tx, installationId: string | null, outbox: NonNullable<LifecycleWrite['outbox']>): Promise<void> {
    const clientKey = outbox.payload.clientKey;
    const [{ lastSeq }] = await tx.$queryRaw<Array<{ lastSeq: number }>>`
      INSERT INTO hub_outbox_sequences ("clientKey", "lastSeq") VALUES (${clientKey}, 1)
      ON CONFLICT ("clientKey") DO UPDATE SET "lastSeq" = hub_outbox_sequences."lastSeq" + 1
      RETURNING "lastSeq"
    `;
    await tx.hubOutboxEvent.create({
      data: {
        clientKey,
        seq: lastSeq,
        installationId,
        type: outbox.type,
        payload: outbox.payload as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
