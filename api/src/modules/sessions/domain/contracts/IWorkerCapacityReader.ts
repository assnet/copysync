import type { LimitChannel } from '../../../tenants/domain/channelLimits';

/** Contagem por canal (canal da sessão = engine, `channelOfEngine`). */
export type ChannelCounts = Record<LimitChannel, number>;

/**
 * Capacidade contratada e uso por plano (WSCALE-09). Agregado: nunca identifica tenant.
 * Só tenants `ACTIVE`; sessões e entitlements dos demais ficam fora.
 */
export interface WorkerCapacityPlanRow {
  /** `Tenant.planSlug`; `null` = grupo "sem plano". */
  planSlug: string | null;
  /** Tenants `ACTIVE` no plano (0 = plano com preset e sem tenant ativo). */
  tenants: number;
  /** Soma dos entitlements `whatsapp_sessions`/`telegram_sessions` dos tenants com limite numérico. */
  contracted: ChannelCounts;
  /** Tenants sem limite numérico no canal (linha ausente, JSON `null` ou valor não numérico = ilimitado). */
  unlimitedTenants: ChannelCounts;
  /** Sessões não apagadas. */
  created: ChannelCounts;
  /** Sessões com lease vivo e status `CONNECTED` (relógio UTC do banco). */
  connected: ChannelCounts;
}

export interface IWorkerCapacityReader {
  /** Uma linha por plano, ordenada por `planSlug` (`null` por último). */
  readByPlan(): Promise<WorkerCapacityPlanRow[]>;
}
