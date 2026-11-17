import type { TenantStatus } from '../../domain/entities/Tenant';
import type { SubscriptionLimitItem } from '../../domain/services/subscriptionLimits';
import type { ProductKey } from '../../domain/services/resolveProductAccess';
import type { TenantProductSource } from '../../domain/contracts/ITenantProductRepository';

/** Produto com acesso (cartão da tela). Afiliados sem linha usa `Tenant.planSlug`/vencimento. */
export interface SubscriptionProductOutput {
  product: ProductKey;
  /** Plano interno cru (`COPYSYNC_*`, `SAVER_*`); o presenter descarta desconhecido. */
  planSlug: string | null;
  expiresAt: Date | null;
  /** `null` = sem linha em `tenant_products` (legado). */
  source: TenantProductSource | null;
}

/** Saída de `GetTenantSubscriptionUseCase` (tela "Assinatura"). Datas cruas: o presenter serializa. */
export interface GetTenantSubscriptionOutput {
  tenantName: string;
  /** Slug cru do tenant; o presenter descarta o que não estiver em `PLAN_SLUGS`. */
  planSlug: string | null;
  status: TenantStatus;
  suspendedAt: Date | null;
  /** `null` = sem vencimento conhecido. */
  expiresAt: Date | null;
  limits: SubscriptionLimitItem[];
  products: SubscriptionProductOutput[];
}
