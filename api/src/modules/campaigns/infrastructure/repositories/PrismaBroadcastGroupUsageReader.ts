import type { PrismaClient } from '@prisma/client';
import type {
  BroadcastGroupCatalogItem,
  BroadcastGroupUsageRow,
  IBroadcastGroupUsageReader,
  ListBroadcastGroupRowsOptions,
} from '../../domain/contracts/IBroadcastGroupUsageReader';

interface LoadedRow extends BroadcastGroupUsageRow {
  sessionName: string;
  title: string | null;
  avatarUrl: string | null;
}

/** Conversa do grupo: mesmo tenant, sessão do mesmo tenant e não apagada. */
const liveGroupConversation = (tenantId: string) => ({
  tenantId,
  session: { tenantId, deletedAt: null },
});

const conversationSelect = {
  groupJid: true,
  sessionId: true,
  groupName: true,
  groupAvatarUrl: true,
  session: { select: { name: true, engine: true } },
} as const;

/**
 * União `offer_destinations` ⋃ `broadcast_groups` (docs da spec broadcast-schedule, BG-01/BG-04).
 * Sessão apagada (do grupo ou do monitoramento) não conta. Toda consulta filtra `tenantId`.
 */
export class PrismaBroadcastGroupUsageReader implements IBroadcastGroupUsageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listRows(tenantId: string, options: ListBroadcastGroupRowsOptions = {}): Promise<BroadcastGroupUsageRow[]> {
    const rows = await this.load(tenantId, options);
    return rows.map(({ conversationId, sessionId, groupJid, engine, use }) => ({ conversationId, sessionId, groupJid, engine, use }));
  }

  async listCatalog(tenantId: string): Promise<BroadcastGroupCatalogItem[]> {
    const byGroup = new Map<string, BroadcastGroupCatalogItem>();
    for (const r of await this.load(tenantId, {})) {
      const key = `${r.sessionId}\u0000${r.groupJid}`;
      const item = byGroup.get(key);
      if (item) {
        if (!item.usedBy.includes(r.use)) item.usedBy.push(r.use);
        continue;
      }
      byGroup.set(key, {
        conversationId: r.conversationId, sessionId: r.sessionId, sessionName: r.sessionName, engine: r.engine,
        groupJid: r.groupJid, title: r.title, avatarUrl: r.avatarUrl, usedBy: [r.use],
      });
    }
    const items = [...byGroup.values()];
    for (const i of items) i.usedBy.sort((a, b) => (a === 'generator' ? -1 : b === 'generator' ? 1 : a.localeCompare(b)));
    return items.sort((a, b) =>
      a.sessionName.localeCompare(b.sessionName) || (a.title ?? '').localeCompare(b.title ?? '') || a.groupJid.localeCompare(b.groupJid));
  }

  private async load(tenantId: string, options: ListBroadcastGroupRowsOptions): Promise<LoadedRow[]> {
    const [generator, monitor] = await Promise.all([
      options.exceptGenerator
        ? Promise.resolve([])
        : this.prisma.offerDestination.findMany({
            where: { tenantId, conversation: { ...liveGroupConversation(tenantId), isGroup: true, groupJid: { not: null } } },
            orderBy: { createdAt: 'asc' },
            select: { conversationId: true, conversation: { select: conversationSelect } },
          }),
      this.prisma.broadcastGroup.findMany({
        where: {
          tenantId,
          conversation: liveGroupConversation(tenantId),
          config: {
            tenantId,
            session: { tenantId, deletedAt: null },
            ...(options.exceptMonitorSessionId ? { sessionId: { not: options.exceptMonitorSessionId } } : {}),
          },
        },
        orderBy: [{ createdAt: 'asc' }, { position: 'asc' }],
        select: {
          conversationId: true, sessionId: true, groupJid: true,
          config: { select: { sessionId: true } },
          conversation: { select: conversationSelect },
        },
      }),
    ]);

    const out: LoadedRow[] = [];
    for (const d of generator) {
      const c = d.conversation;
      if (!c.session || !c.sessionId || !c.groupJid) continue;
      out.push({
        conversationId: d.conversationId, sessionId: c.sessionId, groupJid: c.groupJid, engine: c.session.engine,
        use: 'generator', sessionName: c.session.name, title: c.groupName, avatarUrl: c.groupAvatarUrl,
      });
    }
    for (const b of monitor) {
      const c = b.conversation;
      if (!c.session) continue;
      out.push({
        conversationId: b.conversationId, sessionId: b.sessionId, groupJid: b.groupJid, engine: c.session.engine,
        use: `monitor:${b.config.sessionId}`, sessionName: c.session.name, title: c.groupName, avatarUrl: c.groupAvatarUrl,
      });
    }
    return out;
  }
}
