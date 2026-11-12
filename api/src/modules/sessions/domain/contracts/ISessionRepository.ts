import type { Session } from '../entities/Session';
import type { SessionStatus } from '../enums/SessionStatus';

export interface SessionCreateData {
  tenantId: string;
  name: string;
  engine: string;
  /** Já normalizado (55+DDD+número) pelo use case. */
  declaredPhone?: string | null;
}

export interface SessionStatusUpdate {
  status: SessionStatus;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
  /** true grava `connectRequestedAt = null` na mesma escrita do status (desconectar/sair/excluir). */
  clearConnectRequest?: boolean;
}

/** Limite do plano para sessões não excluídas do tenant, contadas por engine (canal). */
export interface SessionLimit {
  key: string;
  limit: number;
  /** Só sessões desta engine entram na contagem (`whatsapp_sessions` × `telegram_sessions`). */
  engine: string;
}

export interface ISessionRepository {
  create(data: SessionCreateData): Promise<Session>;
  /**
   * Cria só se o tenant ainda está abaixo do limite: contagem + criação serializadas por tenant
   * (lock transacional). Limite atingido → PlanLimitReachedError(key, limit).
   */
  createWithinLimit(data: SessionCreateData, limit: SessionLimit): Promise<Session>;
  findById(id: string, tenantId: string): Promise<Session | null>;
  findAllByTenant(tenantId: string): Promise<Session[]>;
  /**
   * Sessões de TODOS os tenants a religar no boot: status ativo, ou `DISCONNECTED` com pedido de
   * conexão vivo (`connectRequestedAt`), que é o que o shutdown gracioso deixa. Só o
   * SessionBootstrapService usa.
   */
  findActiveSessionsForBootstrap(): Promise<Session[]>;
  /**
   * Mesmo filtro de `findActiveSessionsForBootstrap`, só as sem lease vivo (`leaseUntil` nulo ou
   * vencido no relógio do banco). Usado pelo reconciler do boot (LEASE-10).
   */
  findActiveSessionsWithoutLiveLease(): Promise<Session[]>;
  /**
   * Marca `DISCONNECTED` (com `lastDisconnectedAt`) só se a sessão do tenant ainda estiver ativa,
   * não excluída e sem lease vivo no relógio do banco. Connect local entre o SELECT e o UPDATE
   * (lease tomado) não é sobrescrito. Devolve se gravou.
   */
  markDisconnectedIfNoLiveLease(id: string, tenantId: string): Promise<boolean>;
  /**
   * OWN-04: grava `DISCONNECTED` (com `lastDisconnectedAt` e `connectRequestedAt = null`) só se a
   * sessão do tenant, não excluída, não tem lease vivo de outro processo (sem dono, lease vencido ou
   * dono = `workerId`), no relógio do banco. Só se o tenant ainda não está `ACTIVE` (reativado no
   * meio não derruba o socket novo) e a sessão ainda não está `DISCONNECTED` (sem auditoria
   * repetida), salvo `DISCONNECTED` com lease vivo de `workerId` (status gravado pelo `http`, comando
   * de disconnect não chegou ao dono). Devolve se gravou.
   */
  markDisconnectedUnlessLeasedElsewhere(id: string, tenantId: string, workerId: string): Promise<boolean>;
  /**
   * Sessões não excluídas de tenant não `ACTIVE`, em status ativo e sem dono vivo (lease nulo ou
   * vencido, relógio do banco): ninguém as varre. Até `limit` (padrão 100).
   */
  findOrphanedWithInactiveTenant(limit?: number): Promise<Array<{ id: string; tenantId: string }>>;
  /**
   * Dentre `sessionIds` (as locais do processo), as não excluídas cujo tenant não está `ACTIVE`.
   * Lista vazia não consulta o banco.
   */
  findWithInactiveTenant(sessionIds: readonly string[]): Promise<Array<{ id: string; tenantId: string }>>;
  /** Sessões não excluídas do tenant, por engine (contador de limite do painel). */
  countByEngine(tenantId: string): Promise<Record<string, number>>;
  /** Engine de uma sessão (inclusive excluída), sem tenant: para o roteador de engines. null = inexistente. */
  findEngineById(id: string): Promise<string | null>;
  /**
   * Updates status (and optional timestamps).
   * Callers must pre-validate tenantId ownership via findById.
   */
  updateStatus(id: string, tenantId: string, update: SessionStatusUpdate): Promise<Session>;
  /**
   * Marca pedido de conexão ativo: `connectRequestedAt = COALESCE(atual, now())`.
   * Idempotente (não sobrescreve pedido anterior); filtra `tenantId` e ignora sessão excluída.
   */
  markConnectRequested(id: string, tenantId: string): Promise<void>;
  updatePhone(id: string, tenantId: string, phone: string): Promise<Session>;
  updateExternalRef(id: string, tenantId: string, externalRef: string): Promise<Session>;
  softDelete(id: string, tenantId: string): Promise<void>;
}
