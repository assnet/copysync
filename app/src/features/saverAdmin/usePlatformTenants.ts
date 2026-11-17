import { useCallback, useEffect, useRef, useState } from 'react';
import { saverAdminService } from '@/services/saverAdmin.service';
import { isInvalidCursorError } from './errors';
import type { PlatformTenantOption } from './types';

export interface PlatformTenantsState {
  tenants: PlatformTenantOption[];
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Contas do seletor do filtro (`GET /admin/saver/tenants`, só super admin): página do servidor por cursor
 * assinado, ordem por nome. Dado do servidor: nunca persistido. Cursor recusado recomeça da 1ª página.
 */
export function usePlatformTenants(): PlatformTenantsState {
  const [tenants, setTenants] = useState<PlatformTenantOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await saverAdminService.listTenants(cursor);
      if (mine !== seq.current) return;
      setTenants((prev) => {
        const base = cursor ? prev : [];
        const seen = new Set(base.map((t) => t.id));
        return [...base, ...page.items.filter((t) => !seen.has(t.id))];
      });
      setNextCursor(page.nextCursor);
      setLoading(false);
    } catch (err) {
      if (mine !== seq.current) return;
      if (cursor && isInvalidCursorError(err)) {
        void load(null);
        return;
      }
      setFailed(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => { seq.current++; };
  }, [load]);

  const loadMore = useCallback(() => {
    if (nextCursor && !loading) void load(nextCursor);
  }, [nextCursor, loading, load]);
  const reload = useCallback(() => { void load(null); }, [load]);

  return { tenants, hasMore: nextCursor !== null, loading, failed, loadMore, reload };
}
