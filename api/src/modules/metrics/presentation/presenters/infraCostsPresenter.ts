import type { InfraCostHistoryOutput } from '../../application/use-cases/GetInfraCostHistoryUseCase';
import type { InfraCostSummaryOutput } from '../../application/use-cases/GetInfraCostSummaryUseCase';
import type { ListInfraCostTenantsOutput } from '../../application/use-cases/ListInfraCostTenantsUseCase';

/**
 * `GET /admin/costs/summary` no formato `InfraCostSummary` do painel (`app/src/features/infraCosts/types.ts`).
 * O calculador já segue o contrato; aqui só entram `month`/`generatedAt`, datas ISO e `planLabel` como texto.
 * Nunca id de recurso da Render nem preço de plano do produto.
 */
export function presentInfraCostSummary(out: InfraCostSummaryOutput) {
  const { calculation: c } = out;
  return {
    month: out.month,
    basis: c.basis,
    generatedAt: out.generatedAt.toISOString(),
    fx: c.fx
      ? {
          rate: c.fx.rate,
          referenceDate: c.fx.referenceDate,
          source: c.fx.source,
          fetchedAt: c.fx.fetchedAt ? c.fx.fetchedAt.toISOString() : null,
          stale: c.fx.stale,
        }
      : null,
    sessionsSampledAt: c.sessionsSampledAt ? c.sessionsSampledAt.toISOString() : null,
    totalIsPartial: c.totalIsPartial,
    totals: c.totals,
    items: c.items.map((item) => ({ ...item, planLabel: item.planLabel ?? '' })),
    workspace: c.workspace,
    perSession: {
      contracted: c.perSession.contracted,
      // Foto: sem sessão-hora (`null`); horas: Σ `connectedHours` e custo de uma sessão-hora.
      connected: {
        sessions: c.perSession.connected.sessions,
        perSession: c.perSession.connected.perSession,
        unallocatedSessions: c.perSession.connected.unallocatedSessions,
        unallocatedCost: c.perSession.connected.unallocatedCost,
        sessionHours: c.perSession.connected.sessionHours ?? null,
        perSessionHour: c.perSession.connected.perSessionHour ?? null,
      },
    },
    idleCapacity: c.idleCapacity,
    marginalPerSession: c.marginalPerSession,
    plans: c.plans,
    warnings: c.warnings,
  };
}

/** `GET /admin/costs/tenants`: do tenant só id e nome; nada da Render. */
export function presentInfraCostTenants(out: ListInfraCostTenantsOutput) {
  return {
    month: out.month,
    status: out.status,
    basis: out.basis,
    fx: out.fx,
    tenants: out.tenants.map((t) => ({ ...t })),
    nextCursor: out.nextCursor,
  };
}

/** `GET /admin/costs/history`: datas ISO. */
export function presentInfraCostHistory(out: InfraCostHistoryOutput) {
  return {
    from: out.from,
    to: out.to,
    months: out.months.map((m) => ({ ...m, closedAt: m.closedAt.toISOString() })),
  };
}
