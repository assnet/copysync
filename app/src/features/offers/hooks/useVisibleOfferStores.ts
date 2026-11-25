import { useEffect, useState } from 'react';
import { affiliateCredentialService } from '@/services/affiliateCredential.service';
import type { AffiliateProvider } from '@/types/api.types';
import { DEFAULT_OFFER_STORES } from '../utils/offerStore';

/**
 * Lojas que o gerador reconhece: as visíveis para a conta (`visibleProviders` da lista de
 * credenciais, já com a audiência "Só super admin" aplicada). Enquanto carrega ou em erro,
 * só as lojas de sempre. Dado do servidor: nunca persistido.
 */
export function useVisibleOfferStores(): readonly AffiliateProvider[] {
  const [stores, setStores] = useState<readonly AffiliateProvider[]>(DEFAULT_OFFER_STORES);
  useEffect(() => {
    let alive = true;
    affiliateCredentialService
      .list()
      .then((list) => { if (alive) setStores(list.visibleProviders); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return stores;
}
