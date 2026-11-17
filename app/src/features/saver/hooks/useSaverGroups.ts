import { useCallback, useRef, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { saverService } from '@/services/saver.service';
import { describeSaverError, type SaverError } from '../errors';
import type { SaverGroup, SaverSessionGroup } from '../types';
import { useSaverResource, type SaverResource } from './useSaverResource';

export interface SaverGroupsState extends SaverResource<SaverGroup[]> {
  /** Remove (marca `removedAt` na API); falha volta a lista e preenche `actionError`. */
  remove: (id: string) => Promise<boolean>;
  actionError: SaverError | null;
  clearActionError: () => void;
}

/** Grupos salvos do tenant com contagens (`GET /saver/groups`). */
export function useSaverGroups(): SaverGroupsState {
  const { activeTenantId } = useTenant();
  const resource = useSaverResource(`groups:${activeTenantId ?? ''}`, () => saverService.listGroups());
  const [actionError, setActionError] = useState<SaverError | null>(null);
  const { setData } = resource;
  const dataRef = useRef(resource.data);
  dataRef.current = resource.data;

  const remove = useCallback(async (id: string) => {
    const previous = dataRef.current;
    setData(previous ? previous.filter((g) => g.id !== id) : previous);
    try {
      await saverService.removeGroup(id);
      return true;
    } catch (err) {
      setData(previous);
      setActionError(describeSaverError(err));
      return false;
    }
  }, [setData]);

  return { ...resource, remove, actionError, clearActionError: () => setActionError(null) };
}

/** Grupos ao vivo de uma sessão (`GET /saver/sessions/:id/groups`); `sessionId` null = nada. */
export function useSaverSessionGroups(sessionId: string | null): SaverResource<SaverSessionGroup[]> {
  return useSaverResource(sessionId ? `session-groups:${sessionId}` : null, () => saverService.listSessionGroups(sessionId!));
}
