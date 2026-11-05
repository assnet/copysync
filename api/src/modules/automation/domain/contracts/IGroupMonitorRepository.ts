import type { BroadcastGroup, GroupMonitorConfig, MonitoredGroup } from '../entities/GroupMonitor';
import type { MonitorSettingsWithWeekdays } from '../services/monitorSettings';

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
  /** Janela e a regra de captura fora dela (o listener decide sem outra consulta). */
  windowStartMinute: number;
  windowEndMinute: number;
  /** Dias de postagem (bit 0 = domingo; 127 = todos), para a regra `postingWindow`. */
  weekdaysMask: number;
  captureOutsideWindow: boolean;
}

/**
 * `engine` = engine da sessão dona do grupo (`sessionId`): define o canal do limite do plano.
 * `live` = false quando a sessão dona ou a do monitoramento foi apagada (soft delete): não conta no
 * limite do plano nem no conflito monitorado × disparo, mas segue na lista (a unique do disparo existe).
 */
export interface TenantGroupJids {
  monitored: { sessionId: string; groupJid: string; engine: string; live: boolean }[];
  /** `sessionId` = sessão dona do grupo; `monitorSessionId` = sessão cujo monitoramento o usa. */
  broadcast: { sessionId: string; groupJid: string; monitorSessionId: string; engine: string; live: boolean }[];
}

/** Persistência do monitoramento. Toda consulta filtra por `tenantId` (o listener também). */
export interface IGroupMonitorRepository {
  sessionExists(tenantId: string, sessionId: string): Promise<boolean>;
  /** Engine (canal) de cada sessão do tenant entre `sessionIds`, inclusive apagadas; ausente = não achada. */
  sessionEngines(tenantId: string, sessionIds: string[]): Promise<Map<string, string>>;
  findConfig(tenantId: string, sessionId: string): Promise<GroupMonitorConfig | null>;
  /** Cria com os valores dados ou atualiza; `weekdays` ausente mantém o salvo (na criação: todos). */
  saveSettings(tenantId: string, sessionId: string, settings: MonitorSettingsWithWeekdays): Promise<GroupMonitorConfig>;
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
