import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { UsageMetricsCursorInvalidError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { logger } from '../../../../shared/logger/logger';
import type { UsageTenantDirectoryEntry } from '../../domain/contracts/IUsageTenantDirectory';
import {
  type FeatureUsageFilters,
  type FeatureUsageRow,
  type UsageTenantStatus,
  rankFeatureTenants,
} from '../../domain/services/aggregateFeatureUsage';
import { FEATURE_USAGE_CATALOG, type FeatureUsagePlanFamily } from '../../domain/services/featureUsageCatalog';
import { type UsagePeriod, resolveUsagePeriod } from '../../domain/services/featureUsagePeriod';
import { resolveUsageFeature } from './GetFeatureUsageDetailUseCase';
import { type FeatureUsageDeps, type FeatureUsageQueryInput, USAGE_LIVE_MAX_DAYS, toUsageFilters } from './GetFeatureUsageSummaryUseCase';
import { createFeatureUsageTenantCursor, featureUsageTenantScope, readFeatureUsageTenantCursor } from './featureUsageTenantCursor';

/** Tamanho da página: decisão do servidor (o painel só devolve o cursor). */
export const FEATURE_USAGE_TENANTS_PAGE_SIZE = 25;

const log = logger.child({ module: 'ListFeatureUsageTenants' });

export interface ListFeatureUsageTenantsInput extends FeatureUsageQueryInput {
  featureKey: string;
  cursor?: string;
  actorUserId: string;
}

export interface FeatureUsageTenantItem {
  tenantId: string;
  /** Único dado sensível da feature (o painel borra). */
  tenantName: string;
  /** Plano da conta na família do recurso (`NONE` sem plano). */
  plan: string;
  status: UsageTenantStatus;
  internal: boolean;
  uses: number;
  activeDays: number;
  lastUsedDay: string;
}

export interface ListFeatureUsageTenantsOutput {
  items: FeatureUsageTenantItem[];
  nextCursor: string | null;
}

export interface ListFeatureUsageTenantsDeps extends FeatureUsageDeps {
  audit: IAuditLogRepository;
  /** Log da falha de auditoria (padrão: logger do módulo). */
  log?: { warn(obj: object, msg: string): void };
}

const planIn = (t: UsageTenantDirectoryEntry, family: FeatureUsagePlanFamily) => (family === 'SAVER' ? t.saverPlan : t.affiliatesPlan);

/** Contas do recorte na família do recurso (mesma regra do agregador: status, internas, conta e plano). */
function scopedTenants(tenants: readonly UsageTenantDirectoryEntry[], filters: FeatureUsageFilters, family: FeatureUsagePlanFamily) {
  return new Map(
    tenants
      .filter(
        (t) =>
          (filters.tenantStatus === 'ALL' || t.status === filters.tenantStatus) &&
          (filters.includeInternal || !t.internal) &&
          (!filters.tenantId || t.tenantId === filters.tenantId) &&
          (!filters.plan || planIn(t, family) === filters.plan),
      )
      .map((t) => [t.tenantId, t]),
  );
}

/**
 * Recorte que amarra o cursor e vai para a auditoria: sem nome e sem id de conta (só se há filtro de conta).
 * Datas resolvidas (`from`/`to` efetivos): o mesmo período com ou sem datas explícitas dá o mesmo escopo.
 */
function scopeFilters(input: ListFeatureUsageTenantsInput, period: Pick<UsagePeriod, 'from' | 'to'>) {
  return {
    from: period.from,
    to: period.to,
    kinds: [...input.kinds].sort(),
    plan: input.plan ?? null,
    tenantStatus: input.tenantStatus,
    includeInternal: input.includeInternal,
    hasTenantFilter: Boolean(input.tenantId),
  };
}

/**
 * Contas que mais usam um recurso (super admin), ordem `(uses desc, tenantId asc)`, página de 25 por cursor
 * keyset assinado (escopo = recurso + recorte). Nome só dos ids da página. Primeira página audita
 * `USAGE_METRICS_VIEWED`; falha da auditoria não derruba a leitura.
 */
export class ListFeatureUsageTenantsUseCase {
  constructor(private readonly deps: ListFeatureUsageTenantsDeps) {}

  async execute(input: ListFeatureUsageTenantsInput): Promise<ListFeatureUsageTenantsOutput> {
    const catalog = this.deps.catalog ?? FEATURE_USAGE_CATALOG;
    const { feature, inScope } = resolveUsageFeature(catalog, input);
    const filters = toUsageFilters(input);
    const now = (this.deps.now ?? (() => new Date()))();
    const period = resolveUsagePeriod({ from: input.from, to: input.to, granularity: input.granularity, now, maxDays: USAGE_LIVE_MAX_DAYS });
    const auditFilters = scopeFilters(input, period);
    // O id da conta filtrada entra no escopo só pelo hash (cursor de outra conta não vale).
    const scope = featureUsageTenantScope(feature.key, { ...auditFilters, tenantId: input.tenantId ?? null });
    const after = input.cursor ? readFeatureUsageTenantCursor(input.cursor, scope) : undefined;
    if (after === null) throw new UsageMetricsCursorInvalidError();
    // Recurso fora do recorte (tipo/plano): lista vazia, sem banco e sem auditoria (nenhum nome lido).
    if (!inScope) return { items: [], nextCursor: null };

    const out = await this.deps.gate.runExclusive(async (budget) => {
      const read = await this.deps.reader.read({
        from: period.fromInstant,
        toExclusive: period.toExclusive,
        featureKeys: [feature.key],
        granularity: period.granularity,
        budget,
      });
      const tenants = scopedTenants(await this.deps.directory.list(budget), filters, feature.planFamily);
      const kinds = filters.kinds.length > 0 ? filters.kinds : null;
      const rows = read.rows.filter(
        (r: FeatureUsageRow) =>
          r.featureKey === feature.key &&
          (!kinds || kinds.includes(r.kind)) &&
          r.lastDay >= period.from &&
          r.lastDay <= period.to &&
          tenants.has(r.tenantId),
      );
      const ranked = rankFeatureTenants(rows, feature.key);
      const start = after ? ranked.filter((r) => r.uses < after.uses || (r.uses === after.uses && r.tenantId > after.tenantId)) : ranked;
      const page = start.slice(0, FEATURE_USAGE_TENANTS_PAGE_SIZE);
      const names = await this.deps.directory.names(
        page.map((r) => r.tenantId),
        budget,
      );
      const last = page[page.length - 1];
      return {
        items: page.map((r) => {
          const t = tenants.get(r.tenantId)!;
          return {
            tenantId: r.tenantId,
            tenantName: names.get(r.tenantId) ?? '',
            plan: planIn(t, feature.planFamily),
            status: t.status,
            internal: t.internal,
            uses: r.uses,
            activeDays: r.activeDays,
            lastUsedDay: r.lastUsedDay,
          };
        }),
        nextCursor: start.length > FEATURE_USAGE_TENANTS_PAGE_SIZE && last ? createFeatureUsageTenantCursor(scope, { uses: last.uses, tenantId: last.tenantId }) : null,
      };
    });

    if (!after) {
      try {
        await this.deps.audit.create({
          userId: input.actorUserId,
          action: 'USAGE_METRICS_VIEWED',
          meta: { kind: 'tenants', featureKey: feature.key, filters: auditFilters, count: out.items.length },
        });
      } catch (err) {
        (this.deps.log ?? log).warn({ err, featureKey: feature.key }, 'usage metrics audit failed');
      }
    }
    return out;
  }
}
