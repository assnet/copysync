import { useEffect, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { subscriptionService } from '@/services/subscription.service';

/**
 * Plano Saver atual do tenant (`GET /subscription` → `products[]`). Só destaca o cartão: falha ou
 * resposta antiga = nenhum destaque (a vitrine segue funcionando).
 */
export function useSaverCurrentPlan(): string | null {
  const { activeTenantId } = useTenant();
  const [planSlug, setPlanSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlanSlug(null);
    subscriptionService.getSubscription()
      .then((sub) => {
        const item = sub.products?.find((p) => p.product === 'SAVER');
        if (!cancelled) setPlanSlug(item?.planSlug ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeTenantId]);

  return planSlug;
}
