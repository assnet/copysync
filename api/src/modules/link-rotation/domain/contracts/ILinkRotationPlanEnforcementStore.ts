import type { LinkRotationGroupStatus, LinkRotationStatus } from '../enums/LinkRotationEnums';

/** Grupo com o mínimo para decidir o status sob o limite do plano. */
export interface PlanEnforcementGroup {
  id: string;
  position: number;
  status: LinkRotationGroupStatus;
  inviteCode: string | null;
  memberCount: number | null;
  capacity: number;
}

/** Rotação com o mínimo para decidir o status sob o limite do plano. */
export interface PlanEnforcementRotation {
  id: string;
  status: LinkRotationStatus;
  createdAt: Date;
  groups: PlanEnforcementGroup[];
}

export interface StatusChange<S> {
  id: string;
  status: S;
}

/**
 * Persistência do rebaixo de plano e da sessão removida (LROT-14). Tenant-aware.
 * A implementação Prisma aceita o client de uma transação (billing aplica limites no mesmo commit).
 */
export interface ILinkRotationPlanEnforcementStore {
  listForPlanLimits(tenantId: string): Promise<PlanEnforcementRotation[]>;
  setRotationStatuses(tenantId: string, changes: StatusChange<LinkRotationStatus>[]): Promise<void>;
  setGroupStatuses(tenantId: string, changes: StatusChange<LinkRotationGroupStatus>[]): Promise<void>;
  /** Rotações ACTIVE/PAUSED_BY_PLAN da sessão → PAUSED. Devolve quantas mudaram. */
  pauseBySession(tenantId: string, sessionId: string): Promise<number>;
}
