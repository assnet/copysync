/**
 * Tipos do rodízio de links no painel — espelho do contrato HTTP
 * (`.specs/features/link-rotation/api-contract.md`). Nunca use model da API fora daqui.
 */
import type { SessionStatus } from '@/types/api.types';

export type RotationStatus = 'ACTIVE' | 'PAUSED' | 'PAUSED_BY_PLAN';
export type RotationStrategy = 'BALANCED' | 'SEQUENTIAL' | 'WEIGHTED' | 'RANDOM';
export type RotationGroupStatus = 'ACTIVE' | 'PAUSED' | 'FULL' | 'NEEDS_LINK' | 'PAUSED_BY_PLAN';
export type RotationLinkSource = 'AUTO' | 'MANUAL';

export const ROTATION_STRATEGIES: readonly RotationStrategy[] = ['BALANCED', 'SEQUENTIAL', 'WEIGHTED', 'RANDOM'];

/** Faixas aceitas pela API. */
export const ROTATION_RANGES = {
  capacity: { min: 50, max: 1024, default: 1000 },
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
}

/** `null` = ilimitado. */
export interface RotationLimits {
  linkRotations: number | null;
  linkRotationGroups: number | null;
}

export interface RotationOverview {
  rotations: Rotation[];
  domains: RotationDomainOption[];
  limits: RotationLimits;
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
