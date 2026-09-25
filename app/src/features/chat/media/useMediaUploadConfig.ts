import { useEffect, useState } from 'react';
import { mediaService } from '@/services/media.service';
import type { MediaUploadConfigDto } from '@/types/media.api.types';

export type MediaUploadConfigStatus = 'loading' | 'ready' | 'error';

export interface MediaUploadConfigState {
  /** `null` enquanto carrega ou após falha. */
  config: MediaUploadConfigDto | null;
  status: MediaUploadConfigStatus;
}

/**
 * Limites e capacidades de upload (`GET /media/uploads/config`), buscados uma vez por montagem.
 * `error` → a UI desabilita anexos e microfone com tooltip: sem os limites não há como validar
 * o lote antes de subir.
 */
export function useMediaUploadConfig(): MediaUploadConfigState {
  const [state, setState] = useState<MediaUploadConfigState>({ config: null, status: 'loading' });

  useEffect(() => {
    let active = true;
    mediaService.getUploadConfig().then(
      (config) => {
        if (active) setState({ config, status: 'ready' });
      },
      (error: unknown) => {
        console.error('Erro ao carregar a configuração de upload', error);
        if (active) setState({ config: null, status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
