import { randomUUID } from 'node:crypto';
import { logger } from '../../../shared/logger/logger';
import { internalEventBus } from '../../../shared/events/InternalEventBus';
import type { IBillingReconcileRepository, ReconcileCandidate } from '../application/ports/IBillingReconcileRepository';
import type { IHubSubscriptionsClient } from '../application/ports/IHubSubscriptionsClient';
import { decideReconcile } from '../domain/services/subscriptionReconcile';

const log = logger.child({ module: 'ReconcileSubscriptionsUseCase' });

export interface ReconcileSubscriptionsConfig {
  /** Tenants por passada (lote limitado). */
  batchSize: number;
  leaseTtlMs: number;
  /** Tolerância após o vencimento (`BILLING_GRACE_HOURS`). */
  graceMs: number;
}

/** Resumo de uma passada; só contagens (nunca PII). */
export interface ReconcileSummary {
  examined: number;
  corrected: number;
  /** Central lista assinaturas e nenhuma dá acesso: tenant ACTIVE suspenso. */
  suspended: number;
  /** Central sem nenhuma assinatura do cliente: não suspende. */
  unknownCustomer: number;
  unknownPlan: number;
  adminSuspended: number;
  /** Evento mais novo aplicado pelo webhook durante a consulta. */
  stale: number;
  errors: number;
}

const emptySummary = (): ReconcileSummary => ({
  examined: 0, corrected: 0, suspended: 0, unknownCustomer: 0, unknownPlan: 0, adminSuspended: 0, stale: 0, errors: 0,
});

/**
 * Reconciliação periódica com a central (rede de segurança para evento perdido). Sob lease em
 * tabela; um GET por tenant; decisão pura (`decideReconcile`) tomada com o tenant travado.
 * Ativa/troca plano, suspende quando nenhuma assinatura dá acesso e sobe o watermark.
 * Ver docs/arquitetura-central-billing.md, seção "Reconciliação".
 */
export class ReconcileSubscriptionsUseCase {
  private readonly ownerId = randomUUID();

  constructor(
    private readonly client: IHubSubscriptionsClient,
    private readonly repo: IBillingReconcileRepository,
    private readonly config: ReconcileSubscriptionsConfig,
    private readonly now: () => Date = () => new Date(),
    /** Após o commit da suspensão (desconecta sessões, como no webhook). */
    private readonly notifySuspended: (tenantId: string) => void = (tenantId) =>
      internalEventBus.emit('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId }),
  ) {}

  /** `null` = lease com outro processo (passada não rodou). */
  async execute(): Promise<ReconcileSummary | null> {
    if (!(await this.repo.acquireLease(this.ownerId, this.config.leaseTtlMs))) {
      log.debug('Lease held by another process, skipping reconciliation');
      return null;
    }
    const startedAt = Date.now();
    const summary = emptySummary();
    try {
      const candidates = await this.repo.listCandidates(this.config.batchSize);
      for (const candidate of candidates) {
        summary.examined++;
        try {
          await this.reconcileTenant(candidate, summary);
        } catch (err) {
          summary.errors++;
          log.error({ err, tenantId: candidate.tenantId }, 'Failed to reconcile tenant');
        }
        try {
          await this.repo.markExamined(candidate.tenantId, this.now());
        } catch (err) {
          log.error({ err, tenantId: candidate.tenantId }, 'Failed to mark tenant as reconciled');
        }
      }
      log.info({ ...summary, durationMs: Date.now() - startedAt }, 'Billing reconciliation pass completed');
      return summary;
    } finally {
      await this.repo.releaseLease(this.ownerId);
    }
  }

  private async reconcileTenant(candidate: ReconcileCandidate, summary: ReconcileSummary): Promise<void> {
    const { tenantId } = candidate;
    const result = await this.client.fetchByCustomer(candidate.billingCustomerId);
    if (!result.ok) {
      summary.errors++;
      log.warn({ tenantId, reason: result.reason, status: result.status }, 'Hub subscriptions lookup failed; tenant unchanged');
      return;
    }
    const { snapshot } = result;
    const now = this.now();
    const { decision, found } = await this.repo.reconcileLocked(candidate, (state) => decideReconcile(state, snapshot, now, this.config.graceMs));
    if (!found) return;

    const lastSeq = snapshot.lastSeq?.toString() ?? null;
    switch (decision.kind) {
      case 'apply':
        summary.corrected++;
        log.info({ tenantId, reasons: decision.reasons, planSlug: decision.planSlug, subscriptionId: decision.subscriptionId, lastSeq }, 'Tenant reconciled with hub');
        return;
      case 'suspend':
        summary.suspended++;
        log.warn({ tenantId, subscriptions: snapshot.subscriptions.length, lastSeq }, 'No hub subscription grants access; tenant suspended');
        this.notifySuspended(tenantId);
        return;
      case 'unknown_customer':
        summary.unknownCustomer++;
        log.warn({ tenantId, lastSeq }, 'Hub returned no subscriptions for customer; tenant not suspended');
        return;
      case 'unknown_plan':
        summary.unknownPlan++;
        log.warn({ tenantId, lastSeq }, 'Hub subscription grants access but plan is unknown; not applied');
        return;
      case 'admin_suspended':
        summary.adminSuspended++;
        log.info({ tenantId }, 'Tenant suspended by super-admin; reconciliation does not reactivate');
        return;
      case 'stale':
        summary.stale++;
        log.info({ tenantId, lastSeq }, 'Hub snapshot older than applied event; skipped');
        return;
      case 'noop':
        return;
    }
  }
}
