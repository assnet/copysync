import { ENTITLEMENT_KEYS, type EntitlementKey } from './entitlementKeys';

/**
 * Limites do plano por canal (docs/produto-roadmap.md). O canal de uma sessão vem da engine
 * (`Session.engine`); o de um grupo, da engine da sessão dona dele. Funções puras.
 */
export const LIMIT_CHANNELS = ['whatsapp', 'telegram'] as const;
export type LimitChannel = (typeof LIMIT_CHANNELS)[number];
export type ChannelLimitKind = 'sessions' | 'monitoredGroups' | 'broadcastGroups';

const KEYS: Record<LimitChannel, Record<ChannelLimitKind, EntitlementKey>> = {
  whatsapp: {
    sessions: ENTITLEMENT_KEYS.WHATSAPP_SESSIONS,
    monitoredGroups: ENTITLEMENT_KEYS.MONITORED_GROUPS,
    broadcastGroups: ENTITLEMENT_KEYS.BROADCAST_GROUPS,
  },
  telegram: {
    sessions: ENTITLEMENT_KEYS.TELEGRAM_SESSIONS,
    monitoredGroups: ENTITLEMENT_KEYS.TELEGRAM_MONITORED_GROUPS,
    broadcastGroups: ENTITLEMENT_KEYS.TELEGRAM_BROADCAST_GROUPS,
  },
};

/** Engine → canal. Engine desconhecida/ausente conta como WhatsApp (padrão de `Session.engine`). */
export function channelOfEngine(engine: string | null | undefined): LimitChannel {
  return engine === 'telegram' ? 'telegram' : 'whatsapp';
}

/** Chave de entitlement do limite `kind` no canal da `engine`. */
export function channelLimitKey(kind: ChannelLimitKind, engine: string | null | undefined): EntitlementKey {
  return KEYS[channelOfEngine(engine)][kind];
}

/** Chave por canal (não por engine). */
export function limitKeyOfChannel(kind: ChannelLimitKind, channel: LimitChannel): EntitlementKey {
  return KEYS[channel][kind];
}

/** Quantos itens por canal; `engineOf` dá a engine de cada item. */
export function countByChannel<T>(items: readonly T[], engineOf: (item: T) => string | null | undefined): Record<LimitChannel, number> {
  const out: Record<LimitChannel, number> = { whatsapp: 0, telegram: 0 };
  for (const it of items) out[channelOfEngine(engineOf(it))]++;
  return out;
}

/**
 * `cross_session_dispatch` é exigido só quando mais de uma sessão do MESMO canal participa
 * (ex.: monitor no WhatsApp A enviando no WhatsApp B). Canais diferentes sempre podem.
 */
export function requiresCrossSession(sessions: readonly { id: string; engine: string | null | undefined }[]): boolean {
  const seen: Record<LimitChannel, Set<string>> = { whatsapp: new Set(), telegram: new Set() };
  for (const s of sessions) seen[channelOfEngine(s.engine)].add(s.id);
  return LIMIT_CHANNELS.some((c) => seen[c].size > 1);
}

/**
 * Sem `cross_session_dispatch`: no máximo uma sessão por canal. Fica a `preferred` no canal dela e,
 * nos outros, a primeira que aparece em `items` (ordem preservada).
 */
export function keepOneSessionPerChannel<T>(
  items: readonly T[],
  sessionOf: (item: T) => string,
  engineOf: (sessionId: string) => string | null | undefined,
  preferred?: { id: string; engine: string | null | undefined },
): T[] {
  const chosen = new Map<LimitChannel, string>();
  if (preferred) chosen.set(channelOfEngine(preferred.engine), preferred.id);
  return items.filter((it) => {
    const sid = sessionOf(it);
    const ch = channelOfEngine(engineOf(sid));
    if (!chosen.has(ch)) chosen.set(ch, sid);
    return chosen.get(ch) === sid;
  });
}

/** Corta por canal mantendo a ordem: em cada canal, só os primeiros `limitOf(canal)` (null = sem corte). */
export function sliceByChannel<T>(
  items: readonly T[],
  engineOf: (item: T) => string | null | undefined,
  limitOf: (channel: LimitChannel) => number | null,
): T[] {
  const used: Record<LimitChannel, number> = { whatsapp: 0, telegram: 0 };
  return items.filter((it) => {
    const ch = channelOfEngine(engineOf(it));
    const limit = limitOf(ch);
    if (limit !== null && used[ch] >= Math.max(0, limit)) return false;
    used[ch]++;
    return true;
  });
}
