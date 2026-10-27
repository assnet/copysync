import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import type { IMonitorGroupDirectory } from '../../domain/contracts/IMonitorPorts';
import type { GroupMonitorSettings } from '../../domain/entities/GroupMonitor';
import { DEFAULT_MONITOR_SETTINGS, MONITOR_LIMITS, monitorSettingsProblem, normalizeKeywords } from '../../domain/services/monitorSettings';
import { GroupMonitorGroupConflictError, GroupMonitorInvalidInputError } from '../../../../shared/errors/internal/GroupMonitorErrors';
import { PlanFeatureUnavailableError, PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { GroupMonitorConfigDTO } from '../dtos/GroupMonitorDTO';

export const MONITORED_GROUPS = 'monitored_groups';
export const BROADCAST_GROUPS = 'broadcast_groups';
export const MENTION_ALL_ENABLED = 'mention_all_enabled';

export interface GroupMonitorConfigDeps {
  monitors: IGroupMonitorRepository;
  directory: IMonitorGroupDirectory;
  entitlements: IEntitlementReader;
}

interface SessionInput {
  tenantId: string;
  sessionId: string;
}

/** Base: sessão do tenant + leitura completa (configuração, grupos, limites e uso no tenant). */
abstract class GroupMonitorConfigBase {
  constructor(protected readonly deps: GroupMonitorConfigDeps) {}

  protected async assertSession({ tenantId, sessionId }: SessionInput): Promise<void> {
    if (!(await this.deps.monitors.sessionExists(tenantId, sessionId))) throw new NotFoundError('Session', sessionId);
  }

  protected async load({ tenantId, sessionId }: SessionInput): Promise<GroupMonitorConfigDTO> {
    const { monitors, entitlements } = this.deps;
    const [config, monitored, broadcast, jids, monitoredLimit, broadcastLimit, mentionAll] = await Promise.all([
      monitors.findConfig(tenantId, sessionId),
      monitors.listMonitored(tenantId, sessionId),
      monitors.listBroadcast(tenantId, sessionId),
      monitors.tenantGroupJids(tenantId),
      entitlements.getNumber(tenantId, MONITORED_GROUPS),
      entitlements.getNumber(tenantId, BROADCAST_GROUPS),
      entitlements.getBoolean(tenantId, MENTION_ALL_ENABLED),
    ]);
    const settings: GroupMonitorSettings = config
      ? (({ id: _id, tenantId: _t, sessionId: _s, ...rest }) => rest)(config)
      : { ...DEFAULT_MONITOR_SETTINGS };
    return {
      sessionId,
      settings,
      monitoredGroups: monitored.map((g) => ({ conversationId: g.conversationId, groupJid: g.groupJid, title: g.title, avatarUrl: g.avatarUrl, keywords: g.keywords })),
      broadcastGroups: broadcast.map((g) => ({ conversationId: g.conversationId, groupJid: g.groupJid, title: g.title, avatarUrl: g.avatarUrl, position: g.position })),
      limits: { monitoredGroups: monitoredLimit, broadcastGroups: broadcastLimit, mentionAllEnabled: mentionAll !== false },
      usage: { monitoredGroups: jids.monitored.length, broadcastGroups: jids.broadcast.length },
    };
  }
}

export class GetGroupMonitorConfigUseCase extends GroupMonitorConfigBase {
  async execute(input: SessionInput): Promise<GroupMonitorConfigDTO> {
    await this.assertSession(input);
    return this.load(input);
  }
}

export class SaveGroupMonitorSettingsUseCase extends GroupMonitorConfigBase {
  async execute(input: SessionInput & { settings: GroupMonitorSettings }): Promise<GroupMonitorConfigDTO> {
    await this.assertSession(input);
    const problem = monitorSettingsProblem(input.settings);
    if (problem) throw new GroupMonitorInvalidInputError(problem.reason, problem.field);
    // Ausente = permitido; só `false` explícito bloqueia (mesma regra do gerador)
    if (input.settings.mentionAll && (await this.deps.entitlements.getBoolean(input.tenantId, MENTION_ALL_ENABLED)) === false) {
      throw new PlanFeatureUnavailableError(MENTION_ALL_ENABLED);
    }
    await this.deps.monitors.saveSettings(input.tenantId, input.sessionId, input.settings);
    return this.load(input);
  }
}

type GroupRole = 'monitored' | 'broadcast';

/** Substituição de lista comum aos dois papéis: limites, conflito entre papéis e conversa do chat. */
abstract class SaveGroupsBase extends GroupMonitorConfigBase {
  protected async prepare(input: SessionInput, role: GroupRole, groupJids: string[]): Promise<{ configId: string; conversations: Map<string, string> }> {
    const { tenantId, sessionId } = input;
    await this.assertSession(input);
    const unique = [...new Set(groupJids)];
    if (unique.length !== groupJids.length) throw new GroupMonitorInvalidInputError('duplicated group', 'groups');
    if (unique.length > MONITOR_LIMITS.groupsPerSession) throw new GroupMonitorInvalidInputError('too many groups', 'groups');

    const jids = await this.deps.monitors.tenantGroupJids(tenantId);
    // Outro papel no tenant inteiro: oferta postada voltaria como captura (laço)
    const other = role === 'monitored' ? jids.broadcast : jids.monitored;
    const clash = unique.find((j) => other.some((o) => o.groupJid === j));
    if (clash) throw new GroupMonitorGroupConflictError(clash, role === 'monitored' ? 'broadcast' : 'monitored');

    const key = role === 'monitored' ? MONITORED_GROUPS : BROADCAST_GROUPS;
    const limit = await this.deps.entitlements.getNumber(tenantId, key);
    const elsewhere = (role === 'monitored' ? jids.monitored : jids.broadcast).filter((g) => g.sessionId !== sessionId).length;
    if (limit !== null && elsewhere + unique.length > limit) throw new PlanLimitReachedError(key, limit);

    const configId = await this.deps.monitors.ensureConfig(tenantId, sessionId);
    const conversations = new Map<string, string>();
    for (const groupJid of unique) {
      const { conversationId } = await this.deps.directory.ensureGroup(tenantId, sessionId, groupJid);
      conversations.set(groupJid, conversationId);
    }
    return { configId, conversations };
  }
}

export class SaveMonitoredGroupsUseCase extends SaveGroupsBase {
  async execute(input: SessionInput & { groups: { groupJid: string; keywords: string[] }[] }): Promise<GroupMonitorConfigDTO> {
    const { configId, conversations } = await this.prepare(input, 'monitored', input.groups.map((g) => g.groupJid));
    // Foto da oferta só chega ao media store com o download automático ligado na conversa
    for (const conversationId of conversations.values()) await this.deps.directory.enableMediaDownload(input.tenantId, conversationId);
    await this.deps.monitors.replaceMonitored(input.tenantId, input.sessionId, configId, input.groups.map((g) => ({
      groupJid: g.groupJid,
      conversationId: conversations.get(g.groupJid)!,
      keywords: normalizeKeywords(g.keywords),
    })));
    return this.load(input);
  }
}

export class SaveBroadcastGroupsUseCase extends SaveGroupsBase {
  async execute(input: SessionInput & { groupJids: string[] }): Promise<GroupMonitorConfigDTO> {
    const { configId, conversations } = await this.prepare(input, 'broadcast', input.groupJids);
    await this.deps.monitors.replaceBroadcast(input.tenantId, input.sessionId, configId, input.groupJids.map((groupJid) => ({
      groupJid,
      conversationId: conversations.get(groupJid)!,
    })));
    return this.load(input);
  }
}
