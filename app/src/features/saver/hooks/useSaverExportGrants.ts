import { useCallback, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { saverService } from '@/services/saver.service';
import { describeSaverError, type SaverError } from '../errors';
import type { SaverExportGrant } from '../types';
import { useSaverResource, type SaverResource } from './useSaverResource';

export interface SaverExportGrantsState extends SaverResource<SaverExportGrant[]> {
  /** Ids com gravação em andamento (o `Switch` fica travado). */
  pending: ReadonlySet<string>;
  toggleError: SaverError | null;
  clearToggleError: () => void;
  /** Liga/desliga na hora e desfaz se a API recusar; `false` em falha. */
  toggle: (userId: string, canExport: boolean) => Promise<boolean>;
}

/** Operadores do tenant e a liberação de exportar (`/saver/permissions`, só `ADMIN`). */
export function useSaverExportGrants(enabled = true): SaverExportGrantsState {
  const { activeTenantId } = useTenant();
  const resource = useSaverResource(enabled ? `grants:${activeTenantId ?? ''}` : null, () => saverService.listExportGrants());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [toggleError, setToggleError] = useState<SaverError | null>(null);
  const { setData } = resource;

  const apply = useCallback((userId: string, canExport: boolean) => {
    setData((list) => list?.map((g) => (g.userId === userId ? { ...g, canExport } : g)) ?? list);
  }, [setData]);

  const toggle = useCallback(async (userId: string, canExport: boolean) => {
    setToggleError(null);
    setPending((s) => new Set(s).add(userId));
    apply(userId, canExport);
    try {
      const out = await saverService.setExportGrant(userId, canExport);
      apply(out.userId, out.canExport);
      return true;
    } catch (err) {
      apply(userId, !canExport);
      setToggleError(describeSaverError(err));
      return false;
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(userId);
        return next;
      });
    }
  }, [apply]);

  const clearToggleError = useCallback(() => setToggleError(null), []);
  return { ...resource, pending, toggleError, clearToggleError, toggle };
}
