import { useTenant } from '@/contexts/TenantContext';
import { saverService } from '@/services/saver.service';
import type { SaverOverview } from '../types';
import { useSaverResource, type SaverResource } from './useSaverResource';

/** Limites, uso, permissões efetivas e configuração (`GET /saver/overview`), por tenant ativo. */
export function useSaverOverview(): SaverResource<SaverOverview> {
  const { activeTenantId } = useTenant();
  return useSaverResource(`overview:${activeTenantId ?? ''}`, () => saverService.getOverview());
}
