/**
 * Limites do rodízio por canal (canal = engine da sessão do rodízio). Regras puras, espelho da API
 * (`docs/rodizio-de-links.md`, "Limites por plano"): a API decide; o painel só antecipa o bloqueio.
 */
import { nextPlanFor, type PlanLimitKind } from './planUpsell';
import type {
  Rotation, RotationChannel, RotationChannelLimits, RotationOverview, RotationSessionOption, RotationUsage,
} from './types';

export const ROTATION_CHANNELS: readonly RotationChannel[] = ['whatsapp', 'telegram'];

/** Limites de plano do rodízio que abrem o aviso de upgrade. */
export type RotationLimitKind = Extract<PlanLimitKind, 'rotations' | 'groups' | 'telegramLinkRotations' | 'telegramLinkRotationGroups'>;

const ROTATIONS_KIND: Record<RotationChannel, RotationLimitKind> = { whatsapp: 'rotations', telegram: 'telegramLinkRotations' };
const GROUPS_KIND: Record<RotationChannel, RotationLimitKind> = { whatsapp: 'groups', telegram: 'telegramLinkRotationGroups' };

export const rotationsKindOf = (channel: RotationChannel): RotationLimitKind => ROTATIONS_KIND[channel];
export const groupsKindOf = (channel: RotationChannel): RotationLimitKind => GROUPS_KIND[channel];

/** `meta.key` do `PLAN_LIMIT_REACHED` → tipo do aviso. Chave desconhecida = `null`. */
const KIND_OF_KEY: Record<string, RotationLimitKind> = {
  link_rotations: 'rotations',
  link_rotation_groups: 'groups',
  telegram_link_rotations: 'telegramLinkRotations',
  telegram_link_rotation_groups: 'telegramLinkRotationGroups',
};
export const limitKindOfKey = (key: unknown): RotationLimitKind | null => (typeof key === 'string' ? (KIND_OF_KEY[key] ?? null) : null);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function channelLimits(raw: unknown, fallback: RotationChannelLimits): RotationChannelLimits {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  return { rotations: num(r.rotations), groupsPerRotation: num(r.groupsPerRotation) };
}

/**
 * Resposta do `GET /link-rotation` → overview com limites e uso por canal sempre presentes.
 * API sem blocos por canal: a raiz (legado) vale para os dois; uso contado pelos rodízios listados.
 */
export function normalizeRotationOverview(raw: unknown): RotationOverview {
  const r = (raw ?? {}) as Partial<Omit<RotationOverview, 'limits' | 'usage'>> & { limits?: Record<string, unknown>; usage?: Record<string, unknown> };
  const rotations = Array.isArray(r.rotations) ? r.rotations : [];
  const limits = r.limits ?? {};
  const legacy: RotationChannelLimits = { rotations: num(limits.linkRotations), groupsPerRotation: num(limits.linkRotationGroups) };
  const whatsapp = channelLimits(limits.whatsapp, legacy);
  const telegram = channelLimits(limits.telegram, legacy);
  const usageOf = (channel: RotationChannel) => {
    const used = num((r.usage?.[channel] as Record<string, unknown> | undefined)?.rotations);
    return { rotations: used ?? rotations.filter((x) => x.channel === channel).length };
  };
  const usage: RotationUsage = { whatsapp: usageOf('whatsapp'), telegram: usageOf('telegram') };
  return {
    rotations,
    domains: Array.isArray(r.domains) ? r.domains : [],
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    limits: { linkRotations: whatsapp.rotations, linkRotationGroups: whatsapp.groupsPerRotation, whatsapp, telegram },
    usage,
  };
}

/** Teto de grupos por link no canal do rodízio (`null` = ilimitado). */
export const groupLimitOf = (overview: RotationOverview, channel: RotationChannel): number | null =>
  overview.limits[channel].groupsPerRotation;

/** Canal travado no plano: `noPlan` = limite 0 (canal fora do plano); `full` = vagas usadas. */
export interface ChannelLock {
  channel: RotationChannel;
  reason: 'noPlan' | 'full';
  kind: RotationLimitKind;
  limit: number;
  used: number;
}

function lockFor(channel: RotationChannel, limit: number | null, used: number): ChannelLock | null {
  if (limit === null || used < limit) return null;
  return { channel, reason: limit === 0 ? 'noPlan' : 'full', kind: rotationsKindOf(channel), limit, used };
}

/** Criar link no canal: conta todos os links do canal, inclusive pausados. */
export const createLockOf = (overview: RotationOverview, channel: RotationChannel): ChannelLock | null =>
  lockFor(channel, overview.limits[channel].rotations, overview.usage[channel].rotations);

/**
 * Trava da sessão no seletor do diálogo. Criação: vaga no canal da sessão. Edição: só trocar para
 * outro canal com o link ativo exige vaga, contada pelos links ativos do canal novo (pausado muda livre).
 */
export function sessionLockOf(
  overview: RotationOverview,
  session: Pick<RotationSessionOption, 'channel'>,
  rotation?: Pick<Rotation, 'id' | 'channel'>,
  willBeActive = true,
): ChannelLock | null {
  if (!rotation) return createLockOf(overview, session.channel);
  if (session.channel === rotation.channel || !willBeActive) return null;
  const active = overview.rotations.filter((r) => r.channel === session.channel && r.status === 'ACTIVE' && r.id !== rotation.id).length;
  return lockFor(session.channel, overview.limits[session.channel].rotations, active);
}

/**
 * Trava do botão "Criar link": todo canal com sessão está sem vaga. Devolve a trava do primeiro
 * canal (ordem de `ROTATION_CHANNELS`) para o aviso de upgrade; `null` = dá para criar.
 */
export function createButtonLockOf(overview: RotationOverview): ChannelLock | null {
  const present = ROTATION_CHANNELS.filter((c) => overview.sessions.some((s) => s.channel === c));
  const channels = present.length > 0 ? present : ROTATION_CHANNELS;
  const locks = channels.map((c) => createLockOf(overview, c));
  return locks.every(Boolean) ? locks[0] : null;
}

/** Plano que libera o canal (para "Disponível a partir do …"); `null` = nenhum plano libera. */
export const planUnlockingChannel = (lock: ChannelLock): string | null => nextPlanFor(lock.kind, lock.limit)?.name ?? null;
