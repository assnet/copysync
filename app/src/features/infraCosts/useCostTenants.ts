import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminCostsService } from '@/services/adminCosts.service';
import type { PlanSlug } from '@/features/plans/catalog';
import { tenantPlanQuery } from './rules';
import { infraCostsStrings } from './strings';
import type { InfraCostTenantsPage, InfraCostTenantView } from './types';

type PageMeta = Omit<InfraCostTenantsPage, 'tenants' | 'nextCursor'>;

/**
 * Aba Por cliente (COST-14): `GET /admin/costs/tenants?month=&plan=&cursor=`. Página no servidor: o painel só
 * devolve o `nextCursor` recebido ("Carregar mais" acumula as páginas). Trocar mês ou plano recomeça do início.
 * Nada da resposta é persistido; resposta de filtro antigo que chega depois é descartada.
 */
export function useCostTenants(month: string | null, plan: PlanSlug | 'all') {
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [rows, setRows] = useState<InfraCostTenantView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [slow, setSlow] = useState(false);
  const [monthUnavailable, setMonthUnavailable] = useState(false);
  /** Cursor inválido/expirado (400 `INFRA_COST_CURSOR_INVALID`): lista recarregada do início, com aviso curto. */
  const [cursorReset, setCursorReset] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (keepNotice = false) => {
    const id = ++request.current;
    if (!keepNotice) setCursorReset(false);
    // "Carregar mais" de um filtro antigo é descartado (id mudou): o botão não pode ficar travado.
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const { tenants, nextCursor: next, ...rest } = await adminCostsService.getTenants({ month, plan: tenantPlanQuery(plan) });
      if (id !== request.current) return;
      setMeta(rest);
      setRows(tenants);
      setNextCursor(next);
      setUnavailable(false);
      setSlow(false);
      setMonthUnavailable(false);
    } catch (err) {
      if (id !== request.current) return;
      const code = (err as { code?: unknown } | null)?.code;
      setMeta(null);
      setRows([]);
      setNextCursor(null);
      if (code === 'INFRA_COST_MONTH_UNAVAILABLE') {
        setMonthUnavailable(true);
        setSlow(false);
        setUnavailable(false);
        return;
      }
      setMonthUnavailable(false);
      const isSlow = code === 'INFRA_COST_READ_UNAVAILABLE';
      setError(infraCostsStrings.errors.loadFailed);
      setSlow(isSlow);
      setUnavailable(!isSlow && isServiceUnavailable(err));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [month, plan]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminCostsService.getTenants({ month, plan: tenantPlanQuery(plan), cursor: nextCursor });
      if (id !== request.current) return;
      setRows((prev) => [...prev, ...page.tenants.filter((t) => !prev.some((p) => p.tenantId === t.tenantId))]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (id !== request.current) return;
      if ((err as { code?: unknown } | null)?.code === 'INFRA_COST_CURSOR_INVALID') {
        setCursorReset(true);
        void load(true);
        return;
      }
      setMoreError(infraCostsStrings.errors.loadFailed);
    } finally {
      // Sem condição: resposta de filtro antigo também solta o botão (o `load()` novo não espera por ela).
      setLoadingMore(false);
    }
  }, [month, plan, nextCursor, loadingMore, load]);

  useEffect(() => {
    void load();
  }, [load]);

  return { meta, rows, hasMore: nextCursor !== null, loading, loadingMore, error, moreError, unavailable, slow, monthUnavailable, cursorReset, reload: () => load(), loadMore };
}
