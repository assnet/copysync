import type { PlanLimitKind } from '@/features/linkRotation/planUpsell';
import { channelOf, type SessionChannel } from '@/features/sessions/utils';
import type { GroupMonitorConfigResponse, SessionItem } from '@/types/api.types';

/** Regras puras dos limites por canal do monitoramento (canal do grupo = engine da sessão dona). */

export const CHANNELS: readonly SessionChannel[] = ['whatsapp', 'telegram'];
export type GroupKind = 'monitoredGroups' | 'broadcastGroups';
type Config = Pick<GroupMonitorConfigResponse, 'limits' | 'usage'>;

/** Limite do plano no canal; sem o bloco do canal (API antiga), a raiz vale como WhatsApp. */
export function channelLimit(config: Config, channel: SessionChannel, kind: GroupKind): number | null {
  const block = config.limits[channel];
  if (block) return block[kind];
  return channel === 'whatsapp' ? config.limits[kind] : null;
}

/** Uso no tenant inteiro no canal (todas as sessões). */
export function channelUsage(config: Config, channel: SessionChannel, kind: GroupKind): number {
  const block = config.usage[channel];
  if (block) return block[kind];
  return channel === 'whatsapp' ? config.usage[kind] : 0;
}

/** Canal da sessão pelo id; sessão desconhecida conta como WhatsApp (padrão da API). */
export function sessionChannel(sessions: readonly Pick<SessionItem, 'id' | 'engine'>[], id: string): SessionChannel {
  return channelOf(sessions.find((s) => s.id === id)?.engine);
}

/** Quantos itens por canal. */
export function countByChannel<T>(items: readonly T[], channelOfItem: (item: T) => SessionChannel): Record<SessionChannel, number> {
  const out: Record<SessionChannel, number> = { whatsapp: 0, telegram: 0 };
  for (const it of items) out[channelOfItem(it)]++;
  return out;
}

/** Limite do plano menos o que as outras sessões usam (mesma regra de `sessionGroupCap`). */
function capOf(limit: number | null, tenantUsage: number, thisList: number): number | null {
  return limit === null ? null : Math.max(0, limit - (tenantUsage - thisList));
}

/** Máximo por canal para esta lista: limite do plano menos o que as outras sessões usam no canal. */
export function channelCaps(config: Config, kind: GroupKind, thisList: Record<SessionChannel, number>): Record<SessionChannel, number | null> {
  return {
    whatsapp: capOf(channelLimit(config, 'whatsapp', kind), channelUsage(config, 'whatsapp', kind), thisList.whatsapp),
    telegram: capOf(channelLimit(config, 'telegram', kind), channelUsage(config, 'telegram', kind), thisList.telegram),
  };
}

/** Canais que aparecem nos contadores: os das sessões do tenant (ordem fixa); nenhum → o do monitor. */
export function visibleChannels(sessions: readonly Pick<SessionItem, 'engine'>[], fallback: SessionChannel): SessionChannel[] {
  const present = new Set(sessions.map((s) => channelOf(s.engine)));
  const list = CHANNELS.filter((c) => present.has(c));
  return list.length > 0 ? list : [fallback];
}

/** Limite atingido vindo da API (`PLAN_LIMIT_REACHED` com `meta.key`). */
export interface PlanLimitHit {
  kind: GroupKind | 'sessions';
  channel: SessionChannel;
  limit: number | null;
}

const KEY_OF: Record<string, Omit<PlanLimitHit, 'limit'>> = {
  monitored_groups: { kind: 'monitoredGroups', channel: 'whatsapp' },
  telegram_monitored_groups: { kind: 'monitoredGroups', channel: 'telegram' },
  broadcast_groups: { kind: 'broadcastGroups', channel: 'whatsapp' },
  telegram_broadcast_groups: { kind: 'broadcastGroups', channel: 'telegram' },
  whatsapp_sessions: { kind: 'sessions', channel: 'whatsapp' },
  telegram_sessions: { kind: 'sessions', channel: 'telegram' },
};

/** Lê `meta.key`/`meta.limit` de um erro de limite; null quando não é limite conhecido. */
export function planLimitHit(err: unknown): PlanLimitHit | null {
  const e = (err ?? {}) as { code?: unknown; meta?: { key?: unknown; limit?: unknown } | null };
  if (e.code !== 'PLAN_LIMIT_REACHED') return null;
  const key = typeof e.meta?.key === 'string' ? e.meta.key : null;
  const base = key ? KEY_OF[key] : undefined;
  if (!base) return null;
  return { ...base, limit: typeof e.meta?.limit === 'number' ? e.meta.limit : null };
}

const UPSELL: Record<PlanLimitHit['kind'], Record<SessionChannel, PlanLimitKind>> = {
  monitoredGroups: { whatsapp: 'whatsappMonitoredGroups', telegram: 'telegramMonitoredGroups' },
  broadcastGroups: { whatsapp: 'whatsappBroadcastGroups', telegram: 'telegramBroadcastGroups' },
  sessions: { whatsapp: 'whatsappSessions', telegram: 'telegramSessions' },
};

/** Tipo do aviso de upgrade (`PlanLimitBanner`) para o limite atingido. */
export const upsellKindOf = (hit: Pick<PlanLimitHit, 'kind' | 'channel'>): PlanLimitKind => UPSELL[hit.kind][hit.channel];
