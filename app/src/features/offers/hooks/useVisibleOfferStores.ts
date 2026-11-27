import { useEffect, useState } from 'react';
import { affiliateCredentialService } from '@/services/affiliateCredential.service';
import type { AffiliateProvider } from '@/types/api.types';
import { DEFAULT_OFFER_STORES, type OfferStoreAvailability } from '../utils/offerStore';

export interface VisibleOfferStores {
  /** Lojas visíveis para a conta (`visibleProviders`, audiência "Só super admin" já aplicada). */
  visible: readonly AffiliateProvider[];
  /** Plano por loja (`marketplaceAvailability`); `{}` = todas liberadas. */
  availability: OfferStoreAvailability;
}

const FALLBACK: VisibleOfferStores = { visible: DEFAULT_OFFER_STORES, availability: {} };

/**
 * Lojas que o gerador reconhece e o plano de cada uma. Enquanto carrega ou em erro, só as
 * lojas de sempre, todas liberadas (a API decide de verdade). Dado do servidor: nunca persistido.
 */
export function useVisibleOfferStores(): VisibleOfferStores {
  const [stores, setStores] = useState<VisibleOfferStores>(FALLBACK);
  useEffect(() => {
    let alive = true;
    affiliateCredentialService
      .list()
      .then((list) => { if (alive) setStores({ visible: list.visibleProviders, availability: list.marketplaceAvailability }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return stores;
}
