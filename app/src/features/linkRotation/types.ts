/**
 * Tipos do rodízio de links no painel — espelho do contrato HTTP
 * (`.specs/features/link-rotation/api-contract.md`). Nunca use model da API fora daqui.
 */
import type { SessionStatus } from '@/types/api.types';
import type { SessionChannel } from '@/features/sessions/utils';

/** Canal do rodízio = canal da sessão escolhida (decide formato do convite e teto de membros). */
export type RotationChannel = SessionChannel;

export type RotationStatus = 'ACTIVE' | 'PAUSED' | 'PAUSED_BY_PLAN';
export type RotationStrategy = 'BALANCED' | 'SEQUENTIAL' | 'WEIGHTED' | 'RANDOM';
export type RotationGroupStatus = 'ACTIVE' | 'PAUSED' | 'FULL' | 'NEEDS_LINK' | 'PAUSED_BY_PLAN';
export type RotationLinkSource = 'AUTO' | 'MANUAL';
/** Por que a sessão não gera convite do grupo. */
export type RotationInviteBlockedReason = 'NOT_ADMIN';

export const ROTATION_STRATEGIES: readonly RotationStrategy[] = ['BALANCED', 'SEQUENTIAL', 'WEIGHTED', 'RANDOM'];

/**
 * Teto de membros por canal (mesma faixa da API). WhatsApp: limite real de 1.024. Telegram: grupo
 * básico vira supergrupo ao crescer (até 200.000); canal não tem limite, o teto é o ponto em que o
 * rodízio passa para o próximo grupo. `step` deixa o controle deslizante utilizável na faixa larga.
 */
export const ROTATION_CAPACITY: Record<RotationChannel, { min: number; max: number; default: number; step: number }> = {
  whatsapp: { min: 50, max: 1024, default: 1000, step: 1 },
  telegram: { min: 50, max: 200_000, default: 10_000, step: 50 },
};

/** Faixas aceitas pela API (teto de membros: `ROTATION_CAPACITY`, por canal). */
export const ROTATION_RANGES = {
  weight: { min: 1, max: 100 },
  slug: { min: 3, max: 50, pattern: /^[a-z0-9-]+$/ },
  titleMax: 80,
} as const;

export interface RotationGroup {
  id: string;
  conversationId: string | null;
  groupJid: string;
  groupName: string | null;
  position: number;
  weight: number;
  capacity: number;
  inviteUrl: string | null;
  linkSource: RotationLinkSource | null;
  status: RotationGroupStatus;
  memberCount: number | null;
  /** Última tentativa de leitura (a contagem pode ser antiga se a leitura falhou). */
  memberCountAt: string | null;
  clicksSinceSync: number;
  clickCount: number;
  lastClickAt: string | null;
}

export interface Rotation {
  id: string;
  sessionId: string;
  /** Canal da sessão do rodízio. */
  channel: RotationChannel;
  domainId: string;
  hostname: string;
  slug: string;
  publicUrl: string;
  status: RotationStatus;
  strategy: RotationStrategy;
  title: string | null;
  clickCount: number;
  lastClickAt: string | null;
  allFullNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  groups: RotationGroup[];
}

export interface RotationDomainOption {
  id: string;
  hostname: string;
}

export interface RotationSessionOption {
  id: string;
  name: string;
  status: SessionStatus;
  channel: RotationChannel;
  /** Foto da conta conectada; null fora do ar ou sem foto. */
  avatarUrl: string | null;
}

/** Limites de um canal (`null` = ilimitado; `0` = canal fora do plano). */
export interface RotationChannelLimits {
  rotations: number | null;
  groupsPerRotation: number | null;
}

/**
 * `null` = ilimitado. `linkRotations`/`linkRotationGroups` são o legado (= WhatsApp). Os blocos por
 * canal sempre vêm preenchidos depois do serviço (`normalizeRotationOverview`): API antiga sem
 * eles cai na raiz.
 */
export interface RotationLimits {
  linkRotations: number | null;
  linkRotationGroups: number | null;
  whatsapp: RotationChannelLimits;
  telegram: RotationChannelLimits;
}

/** Links que o tenant possui por canal, inclusive pausados (mesma regra de criar). */
export type RotationUsage = Record<RotationChannel, { rotations: number }>;

export interface RotationOverview {
  rotations: Rotation[];
  domains: RotationDomainOption[];
  limits: RotationLimits;
  usage: RotationUsage;
  sessions: RotationSessionOption[];
}

export interface CreateRotationInput {
  sessionId: string;
  domainId: string;
  slug: string;
  strategy?: RotationStrategy;
  title?: string;
}

/** Ao menos um campo. */
export interface UpdateRotationInput {
  status?: 'ACTIVE' | 'PAUSED';
  strategy?: RotationStrategy;
  title?: string;
  sessionId?: string;
}

export interface RenameRotationInput {
  slug: string;
  domainId?: string;
}

/** Grupo da sessão disponível para o rodízio (`selected` = já está nele). */
export interface RotationGroupCandidate {
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  /** A sessão gera o convite sozinha (admin). `false` = só entra com link manual. Ausente = true. */
  canInvite?: boolean;
  /** Motivo de `canInvite === false`. */
  inviteBlockedReason?: RotationInviteBlockedReason | null;
  selected: boolean;
  rotationGroupId: string | null;
  status: RotationGroupStatus | null;
}

export interface RotationGroupCandidates {
  /** Lista incompleta (sessão ainda sincronizando ou desconectada). */
  partial: boolean;
  groups: RotationGroupCandidate[];
}

/** Item do PUT de grupos: `conversationId` ou `groupJid`. */
export interface SaveRotationGroupInput {
  conversationId?: string;
  groupJid?: string;
  position?: number;
  weight?: number;
  capacity?: number;
  manualInviteUrl?: string | null;
}

export interface RotationGroupStats {
  id: string;
  conversationId: string | null;
  groupName: string | null;
  status: RotationGroupStatus;
  clickCount: number;
  clicksLast7Days: number;
  memberCount: number | null;
  capacity: number;
}

export interface RotationStats {
  rotationId: string;
  clickCount: number;
  clicksLast7Days: number;
  lastClickAt: string | null;
  groups: RotationGroupStats[];
}
