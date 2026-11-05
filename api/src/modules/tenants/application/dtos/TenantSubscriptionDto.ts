import type { TenantStatus } from '../../domain/entities/Tenant';
import type { SubscriptionLimitItem } from '../../domain/services/subscriptionLimits';

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
}
