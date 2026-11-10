import { effectiveImageMode } from '../../../campaigns/domain/enums/OfferImageMode';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import {
  channelOfEngine, countByChannel, LIMIT_CHANNELS, limitKeyOfChannel, requiresCrossSession, type LimitChannel,
} from '../../../tenants/domain/channelLimits';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import type { ICredentialStateSource, IMonitorGroupDirectory } from '../../domain/contracts/IMonitorPorts';
import type { ICapturedOfferRepository } from '../../domain/contracts/ICapturedOfferRepository';
import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';
import type { GroupMonitorSettings } from '../../domain/entities/GroupMonitor';
import { DEFAULT_MONITOR_SETTINGS, MONITOR_LIMITS, monitorSettingsProblem, normalizeKeywords } from '../../domain/services/monitorSettings';
import {
  GroupMonitorBroadcastTakenError, GroupMonitorDuplicateGroupError, GroupMonitorGroupConflictError, GroupMonitorInvalidInputError,
} from '../../../../shared/errors/internal/GroupMonitorErrors';
import { PlanFeatureUnavailableError, PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { postabilityOf } from '../../../campaigns/domain/services/groupPostability';
import { normalizeWindowStartMinute } from '../../../campaigns/domain/services/postingWindow';
import { loadLiveGroups } from '../../../campaigns/application/services/loadLiveGroups';
import { countDistinctBroadcastGroups } from '../../../campaigns/domain/services/broadcastGroupUnion';
import type { IBroadcastGroupUsageReader } from '../../../campaigns/domain/contracts/IBroadcastGroupUsageReader';
import type { CredentialAlertDTO, GroupMonitorConfigDTO } from '../dtos/GroupMonitorDTO';

/** WhatsApp; Telegram em `telegram_*`. Chave por canal: `limitKeyOfChannel` (tenants/domain/channelLimits). */
export const MONITORED_GROUPS = ENTITLEMENT_KEYS.MONITORED_GROUPS;
export const BROADCAST_GROUPS = ENTITLEMENT_KEYS.BROADCAST_GROUPS;
export const MENTION_ALL_ENABLED = ENTITLEMENT_KEYS.MENTION_ALL_ENABLED;
export const CROSS_SESSION_DISPATCH = ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH;
export const ENRICH_LINK_ONLY_ENABLED = ENTITLEMENT_KEYS.ENRICH_LINK_ONLY_ENABLED;
export const CAPTURE_OUTSIDE_WINDOW_ENABLED = ENTITLEMENT_KEYS.CAPTURE_OUTSIDE_WINDOW_ENABLED;
export const AI_REWRITE_ENABLED = ENTITLEMENT_KEYS.AI_REWRITE_ENABLED;

export interface GroupMonitorConfigDeps {
  monitors: IGroupMonitorRepository;
  directory: IMonitorGroupDirectory;
  entitlements: IEntitlementReader;
  credentialStates: ICredentialStateSource;
  captured: ICapturedOfferRepository;
  /** União gerador ⋃ monitoramentos: limite e uso de grupos de disparo (BG-01/BG-03). */
  broadcastUsage: IBroadcastGroupUsageReader;
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
    const num = (kind: 'monitoredGroups' | 'broadcastGroups', ch: LimitChannel) => entitlements.getNumber(tenantId, limitKeyOfChannel(kind, ch));
    const [config, monitored, broadcast, jids, engines, waMon, waBc, tgMon, tgBc, mentionAll, crossSession, enrichLinkOnly, captureOutside, aiRewrite, unionRows] = await Promise.all([
      monitors.findConfig(tenantId, sessionId),
      monitors.listMonitored(tenantId, sessionId),
      monitors.listBroadcast(tenantId, sessionId),
      monitors.tenantGroupJids(tenantId),
      monitors.sessionEngines(tenantId, [sessionId]),
      num('monitoredGroups', 'whatsapp'),
      num('broadcastGroups', 'whatsapp'),
      num('monitoredGroups', 'telegram'),
      num('broadcastGroups', 'telegram'),
      entitlements.getBoolean(tenantId, MENTION_ALL_ENABLED),
      entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH),
      entitlements.getBoolean(tenantId, ENRICH_LINK_ONLY_ENABLED),
      entitlements.getBoolean(tenantId, CAPTURE_OUTSIDE_WINDOW_ENABLED),
      entitlements.getBoolean(tenantId, AI_REWRITE_ENABLED),
      this.deps.broadcastUsage.listRows(tenantId),
    ]);
    const live = broadcast.length > 0
      ? await loadLiveGroups(broadcast.map((g) => g.sessionId), (id) => this.deps.directory.listParticipating(id))
      : new Map();
    const settings: GroupMonitorSettings = config
      ? (({ id: _id, tenantId: _t, sessionId: _s, ...rest }) => rest)(config)
      : { ...DEFAULT_MONITOR_SETTINGS };
    // Grupos de sessão apagada não ocupam cota
    const mon = countByChannel(jids.monitored.filter((g) => g.live), (g) => g.engine);
    // Disparo: grupos distintos do gerador + todos os monitoramentos (D4: configurado conta, sem consulta à engine)
    const bc = countDistinctBroadcastGroups(unionRows, (r) => r.engine);
    const whatsapp = { monitoredGroups: waMon, broadcastGroups: waBc };
    const usageWa = { monitoredGroups: mon.whatsapp, broadcastGroups: bc.whatsapp };
    return {
      sessionId,
      channel: channelOfEngine(engines.get(sessionId)),
      settings,
      monitoredGroups: monitored.map((g) => ({ conversationId: g.conversationId, groupJid: g.groupJid, title: g.title, avatarUrl: g.avatarUrl, keywords: g.keywords })),
      broadcastGroups: broadcast.map((g) => ({ conversationId: g.conversationId, groupJid: g.groupJid, sessionId: g.sessionId, title: g.title, avatarUrl: g.avatarUrl, position: g.position,
        ...postabilityOf(live, g.sessionId, g.groupJid),
      })),
      limits: {
        ...whatsapp, mentionAllEnabled: mentionAll !== false, crossSessionDispatch: crossSession === true,
        enrichLinkOnlyEnabled: enrichLinkOnly === true,
        captureOutsideWindowEnabled: captureOutside === true,
        aiRewriteEnabled: aiRewrite !== false,
        whatsapp, telegram: { monitoredGroups: tgMon, broadcastGroups: tgBc },
      },
      usage: { ...usageWa, whatsapp: usageWa, telegram: { monitoredGroups: mon.telegram, broadcastGroups: bc.telegram } },
      takenBroadcastGroups: jids.broadcast
        // Monitoramento de sessão apagada não toma o grupo: o próximo save libera a linha
        .filter((b) => b.live && b.monitorSessionId !== sessionId)
        .map((b) => ({ groupJid: b.groupJid, sessionId: b.sessionId, monitorSessionId: b.monitorSessionId })),
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

/** Campos opcionais (cliente anterior a eles): mantém o valor salvo, senão o padrão. */
export type GroupMonitorSettingsInput = Omit<GroupMonitorSettings, 'captureOutsideWindow' | 'imageMode'>
  & Partial<Pick<GroupMonitorSettings, 'captureOutsideWindow' | 'imageMode'>>;

export class SaveGroupMonitorSettingsUseCase extends GroupMonitorConfigBase {
  async execute(input: SessionInput & { settings: GroupMonitorSettingsInput }): Promise<GroupMonitorConfigDTO> {
    await this.assertSession(input);
    const { captureOutsideWindow, imageMode } = input.settings;
    const saved = captureOutsideWindow === undefined || imageMode === undefined
      ? await this.deps.monitors.findConfig(input.tenantId, input.sessionId)
      : null;
    const settings: GroupMonitorSettings = {
      ...input.settings,
      captureOutsideWindow: captureOutsideWindow ?? saved?.captureOutsideWindow ?? DEFAULT_MONITOR_SETTINGS.captureOutsideWindow,
      imageMode: effectiveImageMode(imageMode ?? saved?.imageMode ?? DEFAULT_MONITOR_SETTINGS.imageMode),
    };
    const problem = monitorSettingsProblem(settings);
    if (problem) throw new GroupMonitorInvalidInputError(problem.reason, problem.field);
    // Ausente = permitido; só `false` explícito bloqueia (mesma regra do gerador)
    if (settings.mentionAll && (await this.deps.entitlements.getBoolean(input.tenantId, MENTION_ALL_ENABLED)) === false) {
      throw new PlanFeatureUnavailableError(MENTION_ALL_ENABLED);
    }
    // Recurso Pro/Max: ausente bloqueia (só `true` libera)
    if (settings.enrichLinkOnly && (await this.deps.entitlements.getBoolean(input.tenantId, ENRICH_LINK_ONLY_ENABLED)) !== true) {
      throw new PlanFeatureUnavailableError(ENRICH_LINK_ONLY_ENABLED);
    }
    // Só Max. Desliga em vez de recusar: o padrão do banco é ligado e cliente antigo reenvia o salvo
    if (settings.captureOutsideWindow && (await this.deps.entitlements.getBoolean(input.tenantId, CAPTURE_OUTSIDE_WINDOW_ENABLED)) !== true) {
      settings.captureOutsideWindow = false;
    }
    // Reescrita com IA é PRO/MAX (só `false` trava): LITE grava o Modelo em vez de recusar
    if (settings.textMode === 'AI' && (await this.deps.entitlements.getBoolean(input.tenantId, AI_REWRITE_ENABLED)) === false) {
      settings.textMode = 'TEMPLATE';
      settings.audience = 'STANDARD';
    }
    // Início 24:00 grava 0 (mesmo dia): regra TS e claim SQL leem igual
    settings.windowStartMinute = normalizeWindowStartMinute(settings.windowStartMinute, settings.windowEndMinute);
    await this.deps.monitors.saveSettings(input.tenantId, input.sessionId, settings);
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
    // Mesmo grupo por duas sessões: a oferta sairia duas vezes nele
    const seenJids = new Set<string>();
    for (const r of unique) {
      if (seenJids.has(r.groupJid)) throw new GroupMonitorDuplicateGroupError(r.groupJid);
      seenJids.add(r.groupJid);
    }
    if (unique.length > MONITOR_LIMITS.groupsPerSession) throw new GroupMonitorInvalidInputError('too many groups', 'groups');

    // Engine (canal) de cada sessão envolvida; sessão de destino precisa existir no tenant
    const foreign = [...new Set(unique.filter((r) => r.sessionId !== sessionId).map((r) => r.sessionId))];
    const engines = await this.deps.monitors.sessionEngines(tenantId, [sessionId, ...foreign]);
    const engineOf = (id: string) => engines.get(id) ?? 'baileys';
    // 2+ sessões do mesmo canal (monitor + destino): feature do plano (Business). Canais diferentes sempre podem
    if (requiresCrossSession([sessionId, ...foreign].map((id) => ({ id, engine: engineOf(id) })))
      && (await this.deps.entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH)) !== true) {
      throw new PlanFeatureUnavailableError(CROSS_SESSION_DISPATCH);
    }
    for (const other of foreign) {
      if (!(await this.deps.monitors.sessionExists(tenantId, other))) throw new NotFoundError('Session', other);
    }

    const jids = await this.deps.monitors.tenantGroupJids(tenantId);
    // Outro papel no tenant inteiro: oferta postada voltaria como captura (laço)
    const other = (role === 'monitored' ? jids.broadcast : jids.monitored).filter((g) => g.live);
    const clash = unique.find((r) => other.some((o) => o.groupJid === r.groupJid));
    if (clash) throw new GroupMonitorGroupConflictError(clash.groupJid, role === 'monitored' ? 'broadcast' : 'monitored');
    // Mesmo grupo (sessão + JID) como destino de outro monitoramento: a unique do banco recusaria.
    // Linha de monitoramento apagado (`!live`) não toma: `replaceBroadcast` a apaga na mesma transação
    if (role === 'broadcast') {
      for (const r of unique) {
        const taken = jids.broadcast.find((b) => b.live && b.monitorSessionId !== sessionId && b.sessionId === r.sessionId && b.groupJid === r.groupJid);
        if (taken) throw new GroupMonitorBroadcastTakenError(r.groupJid, r.sessionId, taken.monitorSessionId);
      }
    }

    // Limite por canal (canal do grupo = engine da sessão dona); só canais com grupo pedido são checados
    const kind = role === 'monitored' ? 'monitoredGroups' : 'broadcastGroups';
    const asked = countByChannel(unique, (r) => engineOf(r.sessionId));
    // Total após o save. Disparo: união distinta (sessão + JID) com o gerador e os outros monitoramentos (BG-01)
    const total = role === 'monitored'
      ? (() => {
          const used = countByChannel(jids.monitored.filter((g) => g.live && g.sessionId !== sessionId), (g) => g.engine);
          return { whatsapp: used.whatsapp + asked.whatsapp, telegram: used.telegram + asked.telegram };
        })()
      : countDistinctBroadcastGroups<{ sessionId: string; groupJid: string; engine: string }>([
          ...(await this.deps.broadcastUsage.listRows(tenantId, { exceptMonitorSessionId: sessionId })),
          ...unique.map((r) => ({ ...r, engine: engineOf(r.sessionId) })),
        ], (r) => r.engine);
    for (const ch of LIMIT_CHANNELS) {
      if (asked[ch] === 0) continue;
      const key = limitKeyOfChannel(kind, ch);
      const limit = await this.deps.entitlements.getNumber(tenantId, key);
      if (limit !== null && total[ch] > limit) throw new PlanLimitReachedError(key, limit);
    }

    const configId = await this.deps.monitors.ensureConfig(tenantId, sessionId);
    const conversations = new Map<string, string>();
    // Monitorado só lê (canal só de leitura serve); destino precisa poder postar
    const purpose = role === 'monitored' ? 'monitor' : 'send';
    for (const r of unique) {
      const { conversationId } = await this.deps.directory.ensureGroup(tenantId, r.sessionId, r.groupJid, purpose);
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
