import type { LinkRotationGroupStatus } from '../enums/LinkRotationEnums';

/** Grupo que o job de membros precisa ler (só o necessário para a chamada e a regra de status). */
export interface MemberSyncDueGroup {
  id: string;
  tenantId: string;
  rotationId: string;
  sessionId: string;
  groupJid: string;
  capacity: number;
  status: LinkRotationGroupStatus;
  clicksSinceSync: number;
}

/**
 * Critério de "vencido": `memberCountAt` nulo ou anterior a `staleBefore`, OU
 * `clicksSinceSync ≥ clickBurst` com `memberCountAt` anterior a `burstBefore` (piso anti-rajada).
 * Só rotação ACTIVE, grupo ACTIVE/FULL, sessão CONNECTED sem `deletedAt`, tenant ACTIVE.
 */
export interface MemberSyncDueQuery {
  staleBefore: Date;
  burstBefore: Date;
  clickBurst: number;
  limit: number;
}

export interface ApplyMemberCountInput {
  tenantId: string;
  groupId: string;
  memberCount: number;
  at: Date;
  /** `clicksSinceSync` visto na seleção: é subtraído (clique que chegou durante a leitura não se perde). */
  clicksSeen: number;
  /** Aplicado só se o grupo ainda está ACTIVE/FULL (pausa concorrente vence). */
  status: LinkRotationGroupStatus;
}

/**
 * Persistência do job de membros do rodízio (cross-tenant por natureza: varre todos os tenants;
 * toda escrita filtra por `tenantId` + id).
 */
export interface ILinkRotationMemberSyncStore {
  /** Ordem: mais antigo primeiro (`memberCountAt` nulo antes), depois por sessão. */
  listDue(query: MemberSyncDueQuery): Promise<MemberSyncDueGroup[]>;
  applyMemberCount(input: ApplyMemberCountInput): Promise<void>;
  /** Leitura falhou (erro que não é sessão desconectada): marca `memberCountAt` para respeitar o teto de 15 min. */
  markAttempt(tenantId: string, groupId: string, at: Date): Promise<void>;
}
