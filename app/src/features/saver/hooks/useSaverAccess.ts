import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { saverService } from '@/services/saver.service';

/**
 * Uma consulta por usuário + tenant: o menu (`AppLayout`) e o guard (`SaverRoute`) dividem a mesma
 * promessa. Falha = invisível (fecha por padrão) e sai do cache para a próxima montagem tentar de novo.
 */
const cache = new Map<string, Promise<boolean>>();

function fetchAccess(key: string): Promise<boolean> {
  let pending = cache.get(key);
  if (!pending) {
    pending = saverService.getAccess()
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
export function resetSaverAccessCache(): void {
  cache.clear();
}

export interface SaverAccessState {
  /** false enquanto carrega ou em erro. */
  visible: boolean;
  loading: boolean;
}

/**
 * `GET /saver/access` (SAVER-47): a API aplica a audiência (flag "Só super admin" em
 * `/admin/plan-entitlements`; a env `SAVER_AUDIENCE` só vale até a flag ser gravada). Visível sem o
 * produto = cadeado no menu (vem de `useProductAccess`, não daqui).
 */
export function useSaverAccess(): SaverAccessState {
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
