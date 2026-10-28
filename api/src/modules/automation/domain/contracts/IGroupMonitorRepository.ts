import type { BroadcastGroup, GroupMonitorConfig, GroupMonitorSettings, MonitoredGroup } from '../entities/GroupMonitor';

export interface MonitoredGroupInput {
  conversationId: string;
  groupJid: string;
  keywords: string[];
}

export interface BroadcastGroupInput {
  /** Sessão que envia (dona do grupo). */
  sessionId: string;
  conversationId: string;
  groupJid: string;
}

/** Grupo monitorado ativo achado pelo listener (sessão + grupo da mensagem). */
export interface ActiveMonitoredGroup {
  id: string;
  tenantId: string;
  configId: string;
  keywords: string[];
}

export interface TenantGroupJids {
  monitored: { sessionId: string; groupJid: string }[];
  /** `sessionId` = sessão dona do grupo; `monitorSessionId` = sessão cujo monitoramento o usa. */
  broadcast: { sessionId: string; groupJid: string; monitorSessionId: string }[];
}

/** Persistência do monitoramento. Toda consulta filtra por `tenantId` (o listener também). */
export interface IGroupMonitorRepository {
  sessionExists(tenantId: string, sessionId: string): Promise<boolean>;
  findConfig(tenantId: string, sessionId: string): Promise<GroupMonitorConfig | null>;
  /** Cria com os valores dados ou atualiza. */
  saveSettings(tenantId: string, sessionId: string, settings: GroupMonitorSettings): Promise<GroupMonitorConfig>;
  /** Garante a linha de configuração (padrões) e devolve o id. */
  ensureConfig(tenantId: string, sessionId: string): Promise<string>;
  listMonitored(tenantId: string, sessionId: string): Promise<MonitoredGroup[]>;
  /** Destinos do monitoramento da sessão (grupos podem ser de outra sessão do tenant). */
  listBroadcast(tenantId: string, monitorSessionId: string): Promise<BroadcastGroup[]>;
  /** Substitui a lista inteira numa transação. */
  replaceMonitored(tenantId: string, sessionId: string, configId: string, groups: MonitoredGroupInput[]): Promise<void>;
  /** Substitui a lista inteira numa transação; `position` = índice. */
  replaceBroadcast(tenantId: string, monitorSessionId: string, configId: string, groups: BroadcastGroupInput[]): Promise<void>;
  /** Grupos usados no tenant inteiro (limites do plano e conflito monitorado × disparo). */
  tenantGroupJids(tenantId: string): Promise<TenantGroupJids>;
  /** Listener: grupo monitorado desta sessão/tenant com o monitoramento ligado. */
  findActiveMonitoredGroup(tenantId: string, sessionId: string, groupJid: string): Promise<ActiveMonitoredGroup | null>;
}
