import { useCallback, useEffect, useState } from 'react';
import { adminLinkDomainsService } from '@/services/adminLinkDomains.service';
import { grantErrorMessage } from '../errors';
import type { CreatePremiumGrantRequest, PremiumSlugGrant } from '../types';

const bySlug = (a: PremiumSlugGrant, b: PremiumSlugGrant) => a.slug.localeCompare(b.slug);

/**
 * Liberações de nomes especiais de um domínio. Nada otimista: conceder e revogar esperam a API
 * (cada uma grava auditoria) e o erro volta para quem chamou exibir.
 */
export function usePremiumGrants(domainId: string) {
  const [grants, setGrants] = useState<PremiumSlugGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setGrants([...(await adminLinkDomainsService.listGrants(domainId))].sort(bySlug));
    } catch (err) {
      setLoadError(grantErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = useCallback(async (body: CreatePremiumGrantRequest) => {
    const item = await adminLinkDomainsService.grant(domainId, body);
    setGrants((prev) => [...prev, item].sort(bySlug));
    return item;
  }, [domainId]);

  const revoke = useCallback(async (grantId: string) => {
    await adminLinkDomainsService.revokeGrant(domainId, grantId);
    setGrants((prev) => prev.filter((g) => g.id !== grantId));
  }, [domainId]);

  return { grants, loading, loadError, reload: load, grant, revoke };
}
