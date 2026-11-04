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
   * Returns all sessions across ALL tenants that were in an active state
   * when the process last ran.  Used only by SessionBootstrapService on startup.
   */
  findActiveSessionsForBootstrap(): Promise<Session[]>;
  /**
   * Mesmo filtro de `findActiveSessionsForBootstrap`, só as sem lease vivo (`leaseUntil` nulo ou
   * vencido no relógio do banco). Usado pelo reconciler do boot (LEASE-10).
   */
  findActiveSessionsWithoutLiveLease(): Promise<Session[]>;
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
