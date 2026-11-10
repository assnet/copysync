import { useCallback, useEffect, useState } from 'react';
import { adminPlanEntitlementsService } from '@/services/adminPlanEntitlements.service';
import { planEntitlementErrorMessage, planEntitlementsAdminStrings as s } from './strings';
import type { AdminPlanEntitlementList, SetPlanEntitlementResult } from './types';

/** Lista chave × plano e troca um valor; o estado local só muda depois que a API confirma. */
export function usePlanEntitlementsAdmin() {
  const [data, setData] = useState<AdminPlanEntitlementList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await adminPlanEntitlementsService.list());
    } catch {
      setLoadError(s.errors.load);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const set = useCallback(async (planSlug: string, key: string, value: boolean): Promise<SetPlanEntitlementResult | null> => {
    setBusy(`${key}:${planSlug}`);
    setActionError(null);
    try {
      const out = await adminPlanEntitlementsService.set(planSlug, key, value);
      setData((prev) => prev && {
        ...prev,
        entitlements: prev.entitlements.map((r) => (r.key === key ? { ...r, plans: { ...r.plans, [planSlug]: out.value } } : r)),
      });
      return out;
    } catch (err) {
      setActionError(planEntitlementErrorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  return { data, loading, loadError, busy, actionError, clearActionError: () => setActionError(null), reload, set };
}
