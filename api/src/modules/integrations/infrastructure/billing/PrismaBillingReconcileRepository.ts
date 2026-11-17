import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../../shared/database/prisma.client';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import type {
  BillingReconcileOutcome,
  IBillingReconcileRepository,
  ReconcileCandidate,
} from '../../application/ports/IBillingReconcileRepository';
import type {
  LocalBillingState, LocalProductState, LocalTenantStatus, ProductReconcileEntry, ReconcileDecision,
} from '../../domain/services/subscriptionReconcile';
import { syncPlanEntitlements } from '../../billing/syncPlanEntitlements';
import { SHARED_KEYS } from '../../../tenants/domain/sharedEntitlements';
import { mergeProductSharedEntitlements, syncProductPlanEntitlements, writeBillingProductRow } from '../../billing/productBilling';
import { createTenantProductRepository } from '../../../tenants/infrastructure/productAccessContainer';
import type { ProductKey } from '../../../tenants/domain/services/resolveProductAccess';

const LEASE_NAME = 'billing-reconcile';
/** Mesmo teto do webhook (lock + entitlements + efeitos do plano). */
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

interface LockedRow {
  id: string;
  status: LocalTenantStatus;
  planSlug: string | null;
  lastBillingEventSeq: bigint | null;
  suspendedAt: Date | null;
  adminBlockedAt: Date | null;
  subscriptionExpiresAt: Date | null;
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

  /**
   * Primeiro (até metade do lote) os ACTIVE com `subscriptionExpiresAt` + tolerância já passado, vencidos há mais
   * tempo primeiro: o corte de vencido não espera o rodízio. O resto do lote segue o rodízio por `billingReconciledAt`.
   */
  async listCandidates(limit: number, now: Date, graceMs: number): Promise<ReconcileCandidate[]> {
    const base = { billingCustomerId: { not: null } } as const;
    const overdue = await this.db.tenant.findMany({
      where: {
        ...base,
        status: 'ACTIVE',
        subscriptionExpiresAt: { lt: new Date(now.getTime() - graceMs) },
        // PROD-28: Afiliados inativo (segue ativo por outro produto) não é "Afiliados vencido"
        tenantProducts: { none: { product: 'AFFILIATES', status: 'INACTIVE' } },
      },
      select: { id: true, billingCustomerId: true },
      orderBy: [{ subscriptionExpiresAt: 'asc' }, { id: 'asc' }],
      take: Math.floor(limit / 2), // floor: com lote 1 o rodízio nunca fica sem vaga
    });
    const rotation = await this.db.tenant.findMany({
      where: { ...base, status: { in: ['ACTIVE', 'SUSPENDED', 'CANCELLED'] }, id: { notIn: overdue.map((r) => r.id) } },
      select: { id: true, billingCustomerId: true },
      orderBy: [{ billingReconciledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: limit - overdue.length,
    });
    return [...overdue, ...rotation].map((r) => ({ tenantId: r.id, billingCustomerId: r.billingCustomerId! }));
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
        SELECT "id", "status"::text AS "status", "planSlug", "lastBillingEventSeq", "suspendedAt",
               "adminBlockedAt", "subscriptionExpiresAt"
          FROM "tenants" WHERE "id" = ${candidate.tenantId} AND "billingCustomerId" = ${candidate.billingCustomerId}
         FOR UPDATE`;
      const row = rows[0];
      if (!row) return { decision: { kind: 'noop' }, found: false };

      // Linhas de produto lidas sob a mesma trava (só leitura; tenant legado = mapa vazio)
      const products = new Map<ProductKey, LocalProductState>(
        (await createTenantProductRepository(tx).findAll(row.id)).map((p) => [
          p.product, { active: p.status === 'ACTIVE', planSlug: p.planSlug, expiresAt: p.expiresAt, source: p.source },
        ]),
      );
      const decision = decide({
        status: row.status,
        planSlug: row.planSlug,
        lastBillingEventSeq: row.lastBillingEventSeq,
        adminBlocked: row.adminBlockedAt !== null,
        subscriptionExpiresAt: row.subscriptionExpiresAt,
        products,
      });
      if (decision.kind === 'suspend') {
        // Mesmo efeito do `subscription.payment_failed` no webhook: entitlements e plano ficam
        await tx.tenant.update({ where: { id: row.id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
        await this.advanceWatermark(tx, row.id, decision.advanceTo);
        await this.audit(tx, row, 'TENANT_STATUS_CHANGED', {
          reasons: ['no_access'], newStatus: 'SUSPENDED', planSlug: row.planSlug, lastSeq: decision.advanceTo?.toString() ?? null,
        });
        // PROD-16: corte total não cria linha de Afiliados; linhas de produto novo existentes ficam inativas
        if (decision.products) await this.applyProducts(tx, row.id, decision.products, { suspended: true });
        return { decision, found: true };
      }
      if (decision.kind === 'products') {
        // Produto novo decide sozinho: nunca `Tenant.planSlug`, vencimento nem entitlements de Afiliados
        if (decision.activate) await tx.tenant.update({ where: { id: row.id }, data: { status: 'ACTIVE', suspendedAt: null } });
        await this.applyProducts(tx, row.id, decision.products, { suspended: false });
        await this.advanceWatermark(tx, row.id, decision.advanceTo);
        await this.audit(tx, row, decision.activate ? 'TENANT_STATUS_CHANGED' : 'TENANT_UPDATED', {
          reasons: decision.reasons,
          newStatus: decision.activate ? 'ACTIVE' : row.status,
          planSlug: row.planSlug,
          products: decision.products.map((p) => ({ product: p.product, active: p.active, planSlug: p.planSlug })),
          lastSeq: decision.advanceTo?.toString() ?? null,
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
      // Tenant com linha de produto (inclusive ADMIN sem assinatura na central): chaves compartilhadas só pelo
      // merge, senão o preset de Afiliados apagaria a contribuição do outro produto (PROD-18).
      const productAware = products.size > 0 || Boolean(decision.products);
      await syncPlanEntitlements(tx, row.id, decision.planSlug, productAware ? { excludeKeys: SHARED_KEYS } : undefined);
      await this.advanceWatermark(tx, row.id, decision.advanceTo);
      await this.audit(tx, row, decision.activate ? 'TENANT_STATUS_CHANGED' : 'TENANT_UPDATED', {
        reasons: decision.reasons,
        newStatus: decision.activate ? 'ACTIVE' : row.status,
        planSlug: decision.planSlug,
        subscriptionId: decision.subscriptionId,
        lastSeq: decision.advanceTo?.toString() ?? null,
      });
      if (decision.products) await this.applyProducts(tx, row.id, decision.products, { suspended: false });
      else if (productAware) await mergeProductSharedEntitlements(tx, row.id);
      return { decision, found: true };
    }, TX_OPTIONS);
  }

  /**
   * Linhas de produto da decisão, na transação da trava. Afiliados ativo só atualiza linha existente (sem linha
   * = ativo); inativo cria, salvo no corte total. Produto novo ativo sincroniza o preset sem chaves compartilhadas;
   * inativo grava a linha (estado estável para a próxima passada). Linha ADMIN nunca é desativada.
   */
  private async applyProducts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entries: readonly ProductReconcileEntry[],
    opts: { suspended: boolean },
  ): Promise<void> {
    for (const e of entries) {
      if (e.product === 'AFFILIATES') {
        if (opts.suspended) continue;
        await writeBillingProductRow(tx, tenantId, { product: 'AFFILIATES', active: e.active, planSlug: e.planSlug, expiresAt: e.expiresAt }, { onlyIfExists: e.active });
        continue;
      }
      if (e.active && e.planSlug && !opts.suspended) {
        await writeBillingProductRow(tx, tenantId, { product: e.product, active: true, planSlug: e.planSlug, expiresAt: e.expiresAt });
        await syncProductPlanEntitlements(tx, tenantId, e.planSlug);
      } else {
        await writeBillingProductRow(tx, tenantId, { product: e.product, active: false, planSlug: null }, { onlyIfExists: opts.suspended });
      }
    }
    // PROD-18: chaves compartilhadas pela união dos produtos ativos
    if (!opts.suspended) await mergeProductSharedEntitlements(tx, tenantId);
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

}
