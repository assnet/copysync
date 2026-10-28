import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import type { ICredentialStateSource, IMonitorGroupDirectory } from '../../domain/contracts/IMonitorPorts';
import type { ICapturedOfferRepository } from '../../domain/contracts/ICapturedOfferRepository';
import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';
import type { GroupMonitorSettings } from '../../domain/entities/GroupMonitor';
import { DEFAULT_MONITOR_SETTINGS, MONITOR_LIMITS, monitorSettingsProblem, normalizeKeywords } from '../../domain/services/monitorSettings';
import { GroupMonitorGroupConflictError, GroupMonitorInvalidInputError } from '../../../../shared/errors/internal/GroupMonitorErrors';
import { PlanFeatureUnavailableError, PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { CredentialAlertDTO, GroupMonitorConfigDTO } from '../dtos/GroupMonitorDTO';

export const MONITORED_GROUPS = ENTITLEMENT_KEYS.MONITORED_GROUPS;
export const BROADCAST_GROUPS = ENTITLEMENT_KEYS.BROADCAST_GROUPS;
export const MENTION_ALL_ENABLED = ENTITLEMENT_KEYS.MENTION_ALL_ENABLED;
export const CROSS_SESSION_DISPATCH = ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH;

export interface GroupMonitorConfigDeps {
  monitors: IGroupMonitorRepository;
  directory: IMonitorGroupDirectory;
  entitlements: IEntitlementReader;
  credentialStates: ICredentialStateSource;
  captured: ICapturedOfferRepository;
  now?: () => Date;
}

/** Janela do aviso "sem credencial": só lojas com captura CREDENTIAL_MISSING neste período. */
export const CREDENTIAL_MISSING_WINDOW_MS = 7 * 24 * 60 * 60_000;

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
    const [config, monitored, broadcast, jids, monitoredLimit, broadcastLimit, mentionAll, crossSession] = await Promise.all([
      monitors.findConfig(tenantId, sessionId),
      monitors.listMonitored(tenantId, sessionId),
      monitors.listBroadcast(tenantId, sessionId),
      monitors.tenantGroupJids(tenantId),
      entitlements.getNumber(tenantId, MONITORED_GROUPS),
      entitlements.getNumber(tenantId, BROADCAST_GROUPS),
      entitlements.getBoolean(tenantId, MENTION_ALL_ENABLED),
      entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH),
    ]);
    const settings: GroupMonitorSettings = config
      ? (({ id: _id, tenantId: _t, sessionId: _s, ...rest }) => rest)(config)
      : { ...DEFAULT_MONITOR_SETTINGS };
    return {
      sessionId,
      settings,
      monitoredGroups: monitored.map((g) => ({ conversationId: g.conversationId, groupJid: g.groupJid, title: g.title, avatarUrl: g.avatarUrl, keywords: g.keywords })),
      broadcastGroups: broadcast.map((g) => ({ conversationId: g.conversationId, groupJid: g.groupJid, sessionId: g.sessionId, title: g.title, avatarUrl: g.avatarUrl, position: g.position })),
      limits: { monitoredGroups: monitoredLimit, broadcastGroups: broadcastLimit, mentionAllEnabled: mentionAll !== false, crossSessionDispatch: crossSession === true },
      usage: { monitoredGroups: jids.monitored.length, broadcastGroups: jids.broadcast.length },
    };
  }
}

export class GetGroupMonitorConfigUseCase extends GroupMonitorConfigBase {
  async execute(input: SessionInput): Promise<GroupMonitorConfigDTO> {
    await this.assertSession(input);
    const dto = await this.load(input);
    dto.credentialAlerts = await this.credentialAlerts(input.tenantId);
    return dto;
  }

  /**
   * Um aviso por loja: recusada (`rejectedAt`) prevalece; senão, não utilizável + captura
   * `CREDENTIAL_MISSING` recente = sem credencial. Só aqui (não no `load`): Save* não pagam as consultas.
   */
  private async credentialAlerts(tenantId: string): Promise<CredentialAlertDTO[]> {
    const now = (this.deps.now ?? (() => new Date()))();
    const [states, missing] = await Promise.all([
      this.deps.credentialStates.listStates(tenantId),
      this.deps.captured.listRecentMissingProviders(tenantId, new Date(now.getTime() - CREDENTIAL_MISSING_WINDOW_MS)),
    ]);
    const recent = new Set(missing);
    const alerts: CredentialAlertDTO[] = [];
    for (const provider of AFFILIATE_PROVIDERS) {
      const st = states.find((s) => s.provider === provider);
      if (st?.rejectedAt) alerts.push({ provider, kind: 'REJECTED', since: st.rejectedAt.toISOString(), code: st.rejectedCode });
      else if ((!st || !st.usable) && recent.has(provider)) alerts.push({ provider, kind: 'MISSING', since: null, code: null });
    }
    return alerts;
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

/** Grupo pedido: JID + sessão dona (monitorado: sempre a do monitor; disparo: pode ser outra). */
interface GroupRef {
  groupJid: string;
  sessionId: string;
}
const refKey = (g: GroupRef) => `${g.sessionId}:${g.groupJid}`;

/** Substituição de lista comum aos dois papéis: limites, conflito entre papéis e conversa do chat. */
abstract class SaveGroupsBase extends GroupMonitorConfigBase {
  protected async prepare(input: SessionInput, role: GroupRole, refs: GroupRef[]): Promise<{ configId: string; conversations: Map<string, string> }> {
    const { tenantId, sessionId } = input;
    await this.assertSession(input);
    const unique = [...new Map(refs.map((r) => [refKey(r), r])).values()];
    if (unique.length !== refs.length) throw new GroupMonitorInvalidInputError('duplicated group', 'groups');
    if (unique.length > MONITOR_LIMITS.groupsPerSession) throw new GroupMonitorInvalidInputError('too many groups', 'groups');

    // Destino em outra sessão do tenant: feature do plano (Business); a sessão precisa existir no tenant
    const foreign = [...new Set(unique.filter((r) => r.sessionId !== sessionId).map((r) => r.sessionId))];
    if (foreign.length > 0) {
      if ((await this.deps.entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH)) !== true) {
        throw new PlanFeatureUnavailableError(CROSS_SESSION_DISPATCH);
      }
      for (const other of foreign) {
        if (!(await this.deps.monitors.sessionExists(tenantId, other))) throw new NotFoundError('Session', other);
      }
    }

    const jids = await this.deps.monitors.tenantGroupJids(tenantId);
    // Outro papel no tenant inteiro: oferta postada voltaria como captura (laço)
    const other = role === 'monitored' ? jids.broadcast : jids.monitored;
    const clash = unique.find((r) => other.some((o) => o.groupJid === r.groupJid));
    if (clash) throw new GroupMonitorGroupConflictError(clash.groupJid, role === 'monitored' ? 'broadcast' : 'monitored');
    // Mesmo grupo (sessão + JID) como destino de outro monitoramento: a unique do banco recusaria
    if (role === 'broadcast') {
      const taken = unique.find((r) => jids.broadcast.some((b) => b.monitorSessionId !== sessionId && b.sessionId === r.sessionId && b.groupJid === r.groupJid));
      if (taken) throw new GroupMonitorInvalidInputError('group already used by another session monitor', 'groups');
    }

    const key = role === 'monitored' ? MONITORED_GROUPS : BROADCAST_GROUPS;
    const limit = await this.deps.entitlements.getNumber(tenantId, key);
    const elsewhere = role === 'monitored'
      ? jids.monitored.filter((g) => g.sessionId !== sessionId).length
      : jids.broadcast.filter((g) => g.monitorSessionId !== sessionId).length;
    if (limit !== null && elsewhere + unique.length > limit) throw new PlanLimitReachedError(key, limit);

    const configId = await this.deps.monitors.ensureConfig(tenantId, sessionId);
    const conversations = new Map<string, string>();
    for (const r of unique) {
      const { conversationId } = await this.deps.directory.ensureGroup(tenantId, r.sessionId, r.groupJid);
      conversations.set(refKey(r), conversationId);
    }
    return { configId, conversations };
  }
}

export class SaveMonitoredGroupsUseCase extends SaveGroupsBase {
  async execute(input: SessionInput & { groups: { groupJid: string; keywords: string[] }[] }): Promise<GroupMonitorConfigDTO> {
    const { configId, conversations } = await this.prepare(input, 'monitored', input.groups.map((g) => ({ groupJid: g.groupJid, sessionId: input.sessionId })));
    // Foto da oferta só chega ao media store com o download automático ligado na conversa
    for (const conversationId of conversations.values()) await this.deps.directory.enableMediaDownload(input.tenantId, conversationId);
    await this.deps.monitors.replaceMonitored(input.tenantId, input.sessionId, configId, input.groups.map((g) => ({
      groupJid: g.groupJid,
      conversationId: conversations.get(`${input.sessionId}:${g.groupJid}`)!,
      keywords: normalizeKeywords(g.keywords),
    })));
    return this.load(input);
  }
}

/** Ordem da lista = ordem de envio. `sessionId` do grupo ausente = a sessão do monitor. */
export class SaveBroadcastGroupsUseCase extends SaveGroupsBase {
  async execute(input: SessionInput & { groups: { groupJid: string; sessionId?: string | null }[] }): Promise<GroupMonitorConfigDTO> {
    const refs: GroupRef[] = input.groups.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId || input.sessionId }));
    const { configId, conversations } = await this.prepare(input, 'broadcast', refs);
    await this.deps.monitors.replaceBroadcast(input.tenantId, input.sessionId, configId, refs.map((r) => ({
      sessionId: r.sessionId,
      groupJid: r.groupJid,
      conversationId: conversations.get(refKey(r))!,
    })));
    return this.load(input);
  }
}
