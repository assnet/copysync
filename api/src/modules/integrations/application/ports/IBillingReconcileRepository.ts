import type { LocalBillingState, ReconcileDecision } from '../../domain/services/subscriptionReconcile';

export interface ReconcileCandidate {
  tenantId: string;
  billingCustomerId: string;
}

export interface BillingReconcileOutcome {
  decision: ReconcileDecision;
  /** false = tenant sumiu ou trocou de cliente antes da trava. */
  found: boolean;
}

export interface IBillingReconcileRepository {
  acquireLease(ownerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(ownerId: string): Promise<void>;
  /**
   * Tenants com cliente da central: primeiro ACTIVE vencidos além da tolerância (até metade do lote), depois
   * ACTIVE/SUSPENDED/CANCELLED menos recentemente reconciliados (estável por id). Total ≤ `limit`.
   */
  listCandidates(limit: number, now: Date, graceMs: number): Promise<ReconcileCandidate[]>;
  /** Marca o tenant como examinado nesta passada (rodízio entre passadas). */
  markExamined(tenantId: string, at: Date): Promise<void>;
  /**
   * Trava o tenant (FOR UPDATE, mesma trava do webhook), chama `decide` com o estado travado e, se
   * `apply`, grava status/plano/vencimento + entitlements + efeitos + AuditLog e sobe o watermark,
   * tudo no mesmo commit. O watermark nunca desce.
   */
  reconcileLocked(
    candidate: ReconcileCandidate,
    decide: (state: LocalBillingState) => ReconcileDecision,
  ): Promise<BillingReconcileOutcome>;
}
