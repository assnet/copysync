import { useEffect, useState } from 'react';
import { mediaService } from '@/services/media.service';
import type { MediaUploadConfigDto } from '@/types/media.api.types';

export type MediaUploadConfigStatus = 'loading' | 'ready' | 'error';

export interface MediaUploadConfigState {
  /** `null` enquanto carrega ou após falha. */
  config: MediaUploadConfigDto | null;
  status: MediaUploadConfigStatus;
}

const FIRST_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

/** Espera antes da nova tentativa após a falha nº `attempt` (0 = 1ª): 1 s, 2 s, 4 s … teto 30 s. */
export function configRetryDelay(attempt: number): number {
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/**
 * Limites e capacidades de upload (`GET /media/uploads/config`). `error` → a UI desabilita
 * anexos e microfone com tooltip: sem os limites não há como validar o lote antes de subir.
 * Por isso uma falha não é definitiva: tenta de novo com espera crescente e, em erro, também ao
 * focar a janela (a espera pode estar em 30 s). Carregada, não busca de novo.
 */
export function useMediaUploadConfig(): MediaUploadConfigState {
  const [state, setState] = useState<MediaUploadConfigState>({ config: null, status: 'loading' });

  useEffect(() => {
    let active = true;
    let loaded = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      if (!active || loaded || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      mediaService.getUploadConfig().then(
        (config) => {
          inFlight = false;
          if (!active) return;
          loaded = true;
          setState({ config, status: 'ready' });
        },
        (error: unknown) => {
          inFlight = false;
          if (!active) return;
          console.error('Erro ao carregar a configuração de upload', error);
          setState((prev) => (prev.status === 'error' ? prev : { config: null, status: 'error' }));
          timer = setTimeout(load, configRetryDelay(failures++));
        },
      );
    };

    window.addEventListener('focus', load);
    load();
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', load);
    };
  }, []);

  return state;
}
