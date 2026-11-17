import { useCallback, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { saverService } from '@/services/saver.service';
import { describeSaverError, type SaverError } from '../errors';
import type { SaverConfig, UpdateSaverConfigInput } from '../types';
import { useSaverResource, type SaverResource } from './useSaverResource';

export interface SaverConfigState extends SaverResource<SaverConfig> {
  saving: boolean;
  saveError: SaverError | null;
  /** Grava e troca o dado local pela resposta; `false` em falha (o rascunho fica). */
  save: (body: UpdateSaverConfigInput) => Promise<boolean>;
}

/** Configuração do Saver do tenant (`GET`/`PUT /saver/config`, só `ADMIN` grava). */
export function useSaverConfig(): SaverConfigState {
  const { activeTenantId } = useTenant();
  const resource = useSaverResource(`config:${activeTenantId ?? ''}`, () => saverService.getConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaverError | null>(null);
  const { setData } = resource;

  const save = useCallback(async (body: UpdateSaverConfigInput) => {
    setSaving(true);
    setSaveError(null);
    try {
      setData(await saverService.updateConfig(body));
      return true;
    } catch (err) {
      setSaveError(describeSaverError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [setData]);

  return { ...resource, saving, saveError, save };
}
