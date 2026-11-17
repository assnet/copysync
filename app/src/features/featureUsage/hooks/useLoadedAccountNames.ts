import { useCallback, useMemo, useState } from 'react';

export interface LoadedAccountNames {
  /** Registra os nomes que a lista de contas do detalhe acabou de carregar. */
  remember: (items: readonly { tenantId: string; tenantName: string }[]) => void;
  /** Nome já carregado da conta, ou `undefined` (o chip mostra o id curto). */
  nameOf: (tenantId: string | null | undefined) => string | undefined;
}

/**
 * Nomes de conta já vistos nesta visita, **só em memória** (nunca em storage): o nome é dado do servidor e sensível.
 * A lista de contas do detalhe registra; o chip da conta filtrada consulta. Depois de um reload o mapa começa vazio.
 */
export function useLoadedAccountNames(): LoadedAccountNames {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map());

  const remember = useCallback((items: readonly { tenantId: string; tenantName: string }[]) => {
    if (items.length === 0) return;
    setNames((prev) => {
      if (items.every((i) => prev.get(i.tenantId) === i.tenantName)) return prev;
      const next = new Map(prev);
      for (const i of items) next.set(i.tenantId, i.tenantName);
      return next;
    });
  }, []);

  const nameOf = useCallback((tenantId: string | null | undefined) => (tenantId ? names.get(tenantId) : undefined), [names]);

  return useMemo(() => ({ remember, nameOf }), [remember, nameOf]);
}
