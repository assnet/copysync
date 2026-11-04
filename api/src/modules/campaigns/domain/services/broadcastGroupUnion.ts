import { channelOfEngine, type LimitChannel } from '../../../tenants/domain/channelLimits';

/** Um uso de grupo como destino de disparo (gerador de ofertas ou monitoramento). */
export interface BroadcastGroupRow {
  sessionId: string;
  groupJid: string;
}

/**
 * Grupos de disparo distintos por canal (BG-01): o mesmo grupo (sessão + JID) usado pelo gerador
 * e por um ou mais monitoramentos conta 1. `engineOf` dá a engine da sessão da linha. Função pura.
 */
export function countDistinctBroadcastGroups<T extends BroadcastGroupRow>(
  rows: readonly T[],
  engineOf: (row: T) => string | null | undefined,
): Record<LimitChannel, number> {
  const seen: Record<LimitChannel, Set<string>> = { whatsapp: new Set(), telegram: new Set() };
  for (const r of rows) seen[channelOfEngine(engineOf(r))].add(`${r.sessionId}\u0000${r.groupJid}`);
  return { whatsapp: seen.whatsapp.size, telegram: seen.telegram.size };
}
