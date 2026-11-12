import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { offerHunterService } from '@/services/offerHunter.service';

/**
 * Uma consulta por usuário + tenant: o menu (`AppLayout`) e o guard (`OfferHunterRoute`) dividem a
 * mesma promessa. Falha = invisível (fecha por padrão) e sai do cache para a próxima montagem tentar
 * de novo. Não é estado operacional: só evita chamada repetida na mesma sessão do navegador.
 */
const cache = new Map<string, Promise<boolean>>();

function fetchAccess(key: string): Promise<boolean> {
  let pending = cache.get(key);
  if (!pending) {
    pending = offerHunterService.getAccess()
      .then((r) => r.visible === true)
      .catch(() => {
        cache.delete(key);
        return false;
      });
    cache.set(key, pending);
  }
  return pending;
}

/** Só para testes. */
export function resetOfferHunterAccessCache(): void {
  cache.clear();
}

export interface OfferHunterAccess {
  /** false enquanto carrega ou em erro. */
  visible: boolean;
  loading: boolean;
}

/** `GET /offer-hunts/access`: a API aplica a audiência (`OFFER_HUNTER_AUDIENCE`); o front não decide por papel. */
export function useOfferHunterAccess(): OfferHunterAccess {
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const key = user ? `${user.id}:${activeTenantId ?? ''}` : null;
  const [state, setState] = useState<{ key: string; visible: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void fetchAccess(key).then((visible) => {
      if (!cancelled) setState({ key, visible });
    });
    return () => { cancelled = true; };
  }, [key]);

  if (!key) return { visible: false, loading: false };
  const loading = state?.key !== key;
  return { visible: !loading && state.visible, loading };
}
