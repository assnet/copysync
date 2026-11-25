import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { IEntitlementSnapshotReader } from '../../domain/contracts/IEntitlementSnapshotReader';
import type { ITenantUsageReader } from '../../domain/contracts/ITenantUsageReader';
import type { ITenantProductRepository } from '../../domain/contracts/ITenantProductRepository';
import { buildSubscriptionLimits } from '../../domain/services/subscriptionLimits';
import {
  accessSourceOf,
  listProductAccess,
  type ProductAccessRow,
  type ProductKey,
} from '../../domain/services/resolveProductAccess';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { FEATURE_AUDIENCE_KEYS } from '../../domain/featureAudience';
import type { FeatureAudienceGate, FeatureAudienceViewer } from '../services/FeatureAudienceGate';
import type { GetTenantSubscriptionOutput, SubscriptionProductOutput } from '../dtos/TenantSubscriptionDto';

/**
 * Plano, status, vencimento e uso × limite do tenant (`GET /subscription`, SUB-01/04). Campos do topo seguem
 * descrevendo Afiliados; `products` lista cada produto com acesso (docs/acesso-por-produto.md).
 */
export class GetTenantSubscriptionUseCase {
  constructor(
    private readonly tenantRepo: ITenantRepository,
    private readonly entitlements: IEntitlementSnapshotReader,
    private readonly usage: ITenantUsageReader,
    private readonly tenantProducts: Pick<ITenantProductRepository, 'findAll'>,
    private readonly audience: Pick<FeatureAudienceGate, 'isVisible'>,
  ) {}

  /** `viewer.isSuperAdmin` do token: item de qualquer chave com flag "Só super admin" ligada some para os demais. */
  async execute(tenantId: string, viewer: FeatureAudienceViewer): Promise<GetTenantSubscriptionOutput> {
    const [tenant, values, usage, rows, hidden] = await Promise.all([
      this.tenantRepo.findById(tenantId),
      this.entitlements.readAll(tenantId),
      this.usage.read(tenantId),
      this.tenantProducts.findAll(tenantId),
      this.hiddenKeys(viewer),
    ]);
    if (!tenant) throw new NotFoundError('Tenant');

    const byProduct = new Map(rows.map((r) => [r.product, r]));
    const access = listProductAccess(new Map<ProductKey, ProductAccessRow>(rows.map((r) => [r.product, { status: r.status }])));
    // CHAT acompanha Afiliados: sem cartão próprio
    const products: SubscriptionProductOutput[] = access.filter((p) => accessSourceOf(p) === p).map((product) => {
      const row = byProduct.get(product);
      if (product === 'AFFILIATES') {
        return {
          product,
          planSlug: row?.planSlug ?? tenant.planSlug,
          expiresAt: row?.expiresAt ?? tenant.subscriptionExpiresAt,
          source: row?.source ?? null,
        };
      }
      return { product, planSlug: row?.planSlug ?? null, expiresAt: row?.expiresAt ?? null, source: row?.source ?? null };
    });

    return {
      tenantName: tenant.name,
      planSlug: tenant.planSlug,
      status: tenant.status,
      suspendedAt: tenant.suspendedAt,
      expiresAt: tenant.subscriptionExpiresAt,
      limits: buildSubscriptionLimits(values, usage, access).filter((item) => !hidden.has(item.key)),
      products,
    };
  }

  private async hiddenKeys(viewer: FeatureAudienceViewer): Promise<ReadonlySet<string>> {
    // Toda chave de audiência; a que não é item da assinatura (ex.: `saver`) não filtra nada
    const visible = await Promise.all(FEATURE_AUDIENCE_KEYS.map((k) => this.audience.isVisible(k, viewer)));
    return new Set(FEATURE_AUDIENCE_KEYS.filter((_, i) => !visible[i]));
  }
}
