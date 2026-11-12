import type { PrismaClient } from '@prisma/client';
import type {
  BroadcastGroupCatalogItem,
  BroadcastGroupUsageRow,
  IBroadcastGroupUsageReader,
  ListBroadcastGroupRowsOptions,
} from '../../domain/contracts/IBroadcastGroupUsageReader';
import type { IBroadcastGroupRemover, RemoveBroadcastGroupResult } from '../../domain/contracts/IBroadcastGroupRemover';

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
 * União `offer_destinations` ⋃ `broadcast_groups` ⋃ `offer_hunter_settings` (docs da spec broadcast-schedule, BG-01/BG-04).
 * Sessão apagada (do grupo ou do monitoramento) não conta. Toda consulta filtra `tenantId`.
 */
export class PrismaBroadcastGroupUsageReader implements IBroadcastGroupUsageReader, IBroadcastGroupRemover {
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
    const rank = (u: string) => (u === 'generator' ? 0 : u === 'hunter' ? 1 : 2);
    for (const i of items) i.usedBy.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return items.sort((a, b) =>
      a.sessionName.localeCompare(b.sessionName) || (a.title ?? '').localeCompare(b.title ?? '') || a.groupJid.localeCompare(b.groupJid));
  }

  /**
   * BG-05: apaga o grupo do gerador, de todos os monitoramentos e do caçador do tenant, numa transação.
   * O grupo é a mesma chave do catálogo (sessão + JID), então conversa duplicada do mesmo grupo sai junto.
   * Conversa que não é grupo do tenant → `found: false` (404 no use case). Sessão apagada não impede a limpeza.
   */
  async removeEverywhere(tenantId: string, conversationId: string): Promise<RemoveBroadcastGroupResult> {
    return this.prisma.$transaction(async (tx) => {
      const conv = await tx.chatConversation.findFirst({
        where: { id: conversationId, tenantId, isGroup: true },
        select: { sessionId: true, groupJid: true },
      });
      if (!conv) return { found: false, removed: 0 };
      const sameGroup = conv.sessionId && conv.groupJid
        ? { tenantId, sessionId: conv.sessionId, groupJid: conv.groupJid }
        : { tenantId, id: conversationId };
      const gen = await tx.offerDestination.deleteMany({ where: { tenantId, conversation: sameGroup } });
      const mon = await tx.broadcastGroup.deleteMany({ where: { tenantId, conversation: sameGroup } });
      // Caçador: a linha é do tenant (1 por tenant); só perde o grupo
      const hunt = await tx.offerHunterSettings.updateMany({ where: { tenantId, conversation: sameGroup }, data: { conversationId: null } });
      return { found: true, removed: gen.count + mon.count + hunt.count };
    });
  }

  private async load(tenantId: string, options: ListBroadcastGroupRowsOptions): Promise<LoadedRow[]> {
    const [generator, monitor, hunter] = await Promise.all([
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
      options.exceptHunter
        ? Promise.resolve([])
        : this.prisma.offerHunterSettings.findMany({
            where: { tenantId, conversation: { ...liveGroupConversation(tenantId), isGroup: true, groupJid: { not: null } } },
            select: { conversationId: true, conversation: { select: conversationSelect } },
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
    for (const h of hunter) {
      const c = h.conversation;
      if (!h.conversationId || !c?.session || !c.sessionId || !c.groupJid) continue;
      out.push({
        conversationId: h.conversationId, sessionId: c.sessionId, groupJid: c.groupJid, engine: c.session.engine,
        use: 'hunter', sessionName: c.session.name, title: c.groupName, avatarUrl: c.groupAvatarUrl,
      });
    }
    return out;
  }
}
