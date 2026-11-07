import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../../shared/database/prisma.client';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import type {
  BillingReconcileOutcome,
  IBillingReconcileRepository,
  ReconcileCandidate,
} from '../../application/ports/IBillingReconcileRepository';
import type { LocalBillingState, LocalTenantStatus, ReconcileDecision } from '../../domain/services/subscriptionReconcile';
import { syncPlanEntitlements } from '../../billing/syncPlanEntitlements';

const LEASE_NAME = 'billing-reconcile';
/** Mesmo teto do webhook (lock + entitlements + efeitos do plano). */
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

interface LockedRow {
  id: string;
  status: LocalTenantStatus;
  planSlug: string | null;
  lastBillingEventSeq: bigint | null;
  suspendedAt: Date | null;
}

export class PrismaBillingReconcileRepository implements IBillingReconcileRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async acquireLease(ownerId: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const { count } = await this.db.jobLease.updateMany({
      where: { name: LEASE_NAME, expiresAt: { lt: now } },
      data: { ownerId, expiresAt },
    });
    if (count > 0) return true;
    try {
      await this.db.jobLease.create({ data: { name: LEASE_NAME, ownerId, expiresAt } });
      return true;
    } catch {
      return false;
    }
  }

  async releaseLease(ownerId: string): Promise<void> {
    await this.db.jobLease.deleteMany({ where: { name: LEASE_NAME, ownerId } }).catch(() => undefined);
  }

  async listCandidates(limit: number): Promise<ReconcileCandidate[]> {
    const rows = await this.db.tenant.findMany({
      where: { billingCustomerId: { not: null }, status: { in: ['ACTIVE', 'SUSPENDED', 'CANCELLED'] } },
      select: { id: true, billingCustomerId: true },
      orderBy: [{ billingReconciledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => ({ tenantId: r.id, billingCustomerId: r.billingCustomerId! }));
  }

  /** SQL direto: só o carimbo do rodízio, sem mexer em `updatedAt`. */
  async markExamined(tenantId: string, at: Date): Promise<void> {
    await this.db.$executeRaw`UPDATE "tenants" SET "billingReconciledAt" = ${at} WHERE "id" = ${tenantId}`;
  }

  async reconcileLocked(
    candidate: ReconcileCandidate,
    decide: (state: LocalBillingState) => ReconcileDecision,
  ): Promise<BillingReconcileOutcome> {
    return this.db.$transaction(async (tx) => {
      // Mesma trava do webhook (`ApplyBillingEventUseCase.lockByCustomer`): eventos e reconciliação serializam
      const rows = await tx.$queryRaw<LockedRow[]>`
        SELECT "id", "status"::text AS "status", "planSlug", "lastBillingEventSeq", "suspendedAt"
          FROM "tenants" WHERE "id" = ${candidate.tenantId} AND "billingCustomerId" = ${candidate.billingCustomerId}
         FOR UPDATE`;
      const row = rows[0];
      if (!row) return { decision: { kind: 'noop' }, found: false };

      const decision = decide({
        status: row.status,
        planSlug: row.planSlug,
        lastBillingEventSeq: row.lastBillingEventSeq,
        blockedByAdmin: row.status !== 'ACTIVE' && (await this.blockedByAdmin(tx, row)),
      });
      if (decision.kind === 'suspend') {
        // Mesmo efeito do `subscription.payment_failed` no webhook: entitlements e plano ficam
        await tx.tenant.update({ where: { id: row.id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
        await this.advanceWatermark(tx, row.id, decision.advanceTo);
        await this.audit(tx, row, 'TENANT_STATUS_CHANGED', {
          reasons: ['no_access'], newStatus: 'SUSPENDED', planSlug: row.planSlug, lastSeq: decision.advanceTo?.toString() ?? null,
        });
        return { decision, found: true };
      }
      if (decision.kind !== 'apply') return { decision, found: true };

      const data: Prisma.TenantUpdateInput = { planSlug: decision.planSlug, subscriptionExpiresAt: decision.expiresAt };
      if (decision.activate) {
        data.status = 'ACTIVE';
        data.suspendedAt = null;
      }
      await tx.tenant.update({ where: { id: row.id }, data });
      await syncPlanEntitlements(tx, row.id, decision.planSlug);
      await this.advanceWatermark(tx, row.id, decision.advanceTo);
      await this.audit(tx, row, decision.activate ? 'TENANT_STATUS_CHANGED' : 'TENANT_UPDATED', {
        reasons: decision.reasons,
        newStatus: decision.activate ? 'ACTIVE' : row.status,
        planSlug: decision.planSlug,
        subscriptionId: decision.subscriptionId,
        lastSeq: decision.advanceTo?.toString() ?? null,
      });
      return { decision, found: true };
    }, TX_OPTIONS);
  }

  /** Watermark só sobe (mesmo guarda do webhook); null = central sem evento, mantém. */
  private async advanceWatermark(tx: Prisma.TransactionClient, tenantId: string, seq: bigint | null): Promise<void> {
    if (seq === null) return;
    await tx.tenant.updateMany({
      where: { id: tenantId, OR: [{ lastBillingEventSeq: null }, { lastBillingEventSeq: { lt: seq } }] },
      data: { lastBillingEventSeq: seq },
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    row: LockedRow,
    action: 'TENANT_STATUS_CHANGED' | 'TENANT_UPDATED',
    meta: Record<string, unknown>,
  ): Promise<void> {
    return new PrismaAuditLogRepository(tx).create({
      tenantId: row.id,
      action,
      meta: {
        origin: 'BILLING_RECONCILE',
        change: 'subscription_reconciled',
        previousStatus: row.status,
        previousPlanSlug: row.planSlug,
        previousSeq: row.lastBillingEventSeq?.toString() ?? null,
        ...meta,
      },
    });
  }

  /**
   * SUSPENDED/CANCELLED por super-admin = auditoria `TENANT_STATUS_CHANGED` de origem SUPER_ADMIN para o status
   * atual, gravada a partir do `suspendedAt` atual. O único caminho do admin (`UpdateTenantStatusUseCase`) grava
   * `suspendedAt` e depois essa auditoria; o webhook (payment_failed / eventos de corte) e a reconciliação gravam
   * `suspendedAt` sem origem SUPER_ADMIN, então status por cobrança = sem essa auditoria.
   * Sem `suspendedAt`: origem desconhecida, tratada como admin (não reativa).
   */
  private async blockedByAdmin(tx: Prisma.TransactionClient, row: LockedRow): Promise<boolean> {
    if (!row.suspendedAt) return true;
    const audit = await tx.auditLog.findFirst({
      where: {
        tenantId: row.id,
        action: 'TENANT_STATUS_CHANGED',
        createdAt: { gte: row.suspendedAt },
        AND: [
          { meta: { path: ['origin'], equals: 'SUPER_ADMIN' } },
          { meta: { path: ['newStatus'], equals: row.status } },
        ],
      },
      select: { id: true },
    });
    return audit !== null;
  }
}
