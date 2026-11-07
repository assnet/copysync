import { env } from '../../../../shared/config/env';
import { ReconcileSubscriptionsUseCase } from '../../billing/ReconcileSubscriptionsUseCase';
import { HubSubscriptionsClient } from './HubSubscriptionsClient';
import { PrismaBillingReconcileRepository } from './PrismaBillingReconcileRepository';

/** Cliente M2M da central a partir do env (reconciliação e eventos de corte); só com `BILLING_ENABLED`. */
export function createHubSubscriptionsClientFromEnv(): HubSubscriptionsClient {
  return new HubSubscriptionsClient({
    hubUrl: env.BILLING_HUB_URL!,
    applicationKey: env.BILLING_APPLICATION_KEY!,
    secret: env.BILLING_APPLICATION_SECRET!,
    timeoutMs: env.BILLING_RECONCILE_HTTP_TIMEOUT_MS,
  });
}

/** Composição da reconciliação a partir do env; chamar só com `BILLING_ENABLED`. */
export function createReconcileSubscriptionsUseCase(): ReconcileSubscriptionsUseCase {
  return new ReconcileSubscriptionsUseCase(createHubSubscriptionsClientFromEnv(), new PrismaBillingReconcileRepository(), {
    batchSize: env.BILLING_RECONCILE_BATCH_SIZE,
    leaseTtlMs: env.BILLING_RECONCILE_LEASE_TTL_MS,
  });
}
