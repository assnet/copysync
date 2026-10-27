import type { PrismaClient } from '@prisma/client';
import type {
  ActiveMonitoredGroup, BroadcastGroupInput, IGroupMonitorRepository, MonitoredGroupInput, TenantGroupJids,
} from '../../domain/contracts/IGroupMonitorRepository';
import type { BroadcastGroup, GroupMonitorConfig, GroupMonitorSettings, MonitoredGroup } from '../../domain/entities/GroupMonitor';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';

const groupView = { select: { groupName: true, groupAvatarUrl: true } } as const;

type ConfigRow = GroupMonitorSettings & { id: string; tenantId: string; sessionId: string };

function toConfig(r: ConfigRow): GroupMonitorConfig {
  return {
    id: r.id, tenantId: r.tenantId, sessionId: r.sessionId, enabled: r.enabled,
    windowStartMinute: r.windowStartMinute, windowEndMinute: r.windowEndMinute,
    intervalMinSeconds: r.intervalMinSeconds, intervalMaxSeconds: r.intervalMaxSeconds,
    startDelaySeconds: r.startDelaySeconds, maxOfferAgeMinutes: r.maxOfferAgeMinutes, couponMaxAgeMinutes: r.couponMaxAgeMinutes,
    mentionAll: r.mentionAll, simulateTyping: r.simulateTyping, typingSeconds: r.typingSeconds,
  };
}

/** Monitoramento de grupos. Toda consulta filtra por `tenantId`. */
export class PrismaGroupMonitorRepository implements IGroupMonitorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async sessionExists(tenantId: string, sessionId: string): Promise<boolean> {
    return (await this.prisma.session.count({ where: { id: sessionId, tenantId, deletedAt: null } })) > 0;
  }

  async findConfig(tenantId: string, sessionId: string): Promise<GroupMonitorConfig | null> {
    const r = await this.prisma.groupMonitorConfig.findUnique({ where: { tenantId_sessionId: { tenantId, sessionId } } });
    return r ? toConfig(r) : null;
  }

  async saveSettings(tenantId: string, sessionId: string, settings: GroupMonitorSettings): Promise<GroupMonitorConfig> {
    const r = await this.prisma.groupMonitorConfig.upsert({
      where: { tenantId_sessionId: { tenantId, sessionId } },
      create: { tenantId, sessionId, ...settings },
      update: settings,
    });
    return toConfig(r);
  }

  async ensureConfig(tenantId: string, sessionId: string): Promise<string> {
    const r = await this.prisma.groupMonitorConfig.upsert({
      where: { tenantId_sessionId: { tenantId, sessionId } },
      create: { tenantId, sessionId, ...DEFAULT_MONITOR_SETTINGS },
      update: {},
      select: { id: true },
    });
    return r.id;
  }

  async listMonitored(tenantId: string, sessionId: string): Promise<MonitoredGroup[]> {
    const rows = await this.prisma.monitoredGroup.findMany({
      where: { tenantId, sessionId },
      include: { conversation: groupView },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id, conversationId: r.conversationId, groupJid: r.groupJid, keywords: r.keywords,
      title: r.conversation.groupName, avatarUrl: r.conversation.groupAvatarUrl,
    }));
  }

  async listBroadcast(tenantId: string, sessionId: string): Promise<BroadcastGroup[]> {
    const rows = await this.prisma.broadcastGroup.findMany({
      where: { tenantId, sessionId },
      include: { conversation: groupView },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id, conversationId: r.conversationId, groupJid: r.groupJid, position: r.position,
      title: r.conversation.groupName, avatarUrl: r.conversation.groupAvatarUrl,
    }));
  }

  async replaceMonitored(tenantId: string, sessionId: string, configId: string, groups: MonitoredGroupInput[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.monitoredGroup.deleteMany({ where: { tenantId, sessionId } }),
      this.prisma.monitoredGroup.createMany({
        data: groups.map((g) => ({ tenantId, sessionId, configId, conversationId: g.conversationId, groupJid: g.groupJid, keywords: g.keywords })),
      }),
    ]);
  }

  async replaceBroadcast(tenantId: string, sessionId: string, configId: string, groups: BroadcastGroupInput[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.broadcastGroup.deleteMany({ where: { tenantId, sessionId } }),
      this.prisma.broadcastGroup.createMany({
        data: groups.map((g, position) => ({ tenantId, sessionId, configId, conversationId: g.conversationId, groupJid: g.groupJid, position })),
      }),
    ]);
  }

  async tenantGroupJids(tenantId: string): Promise<TenantGroupJids> {
    const [monitored, broadcast] = await Promise.all([
      this.prisma.monitoredGroup.findMany({ where: { tenantId }, select: { sessionId: true, groupJid: true } }),
      this.prisma.broadcastGroup.findMany({ where: { tenantId }, select: { sessionId: true, groupJid: true } }),
    ]);
    return { monitored, broadcast };
  }

  /** Índice (sessionId, groupJid); tenant e monitoramento ligado no mesmo filtro. */
  async findActiveMonitoredGroup(tenantId: string, sessionId: string, groupJid: string): Promise<ActiveMonitoredGroup | null> {
    const r = await this.prisma.monitoredGroup.findFirst({
      where: { sessionId, groupJid, tenantId, config: { enabled: true } },
      select: { id: true, tenantId: true, configId: true, keywords: true },
    });
    return r;
  }
}
