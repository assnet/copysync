import { useCallback, useEffect, useRef, useState } from 'react';
import { saverService } from '@/services/saver.service';
import { describeSaverError, type SaverError } from '../errors';
import { isExtractionActive, type SaverExtraction } from '../types';

/** Intervalo da consulta de progresso enquanto a extração está ativa (design.md §5). */
export const SAVER_EXTRACTION_POLL_MS = 3_000;

export interface SaverExtractionState {
  extraction: SaverExtraction | null;
  error: SaverError | null;
  /** true enquanto a extração estiver na fila ou lendo (a consulta segue). */
  active: boolean;
  cancel: () => Promise<void>;
}

/**
 * Progresso de uma extração: consulta a cada 3 s enquanto `QUEUED`/`RUNNING` e para ao terminar,
 * ao trocar o id ou ao desmontar. Um `setTimeout` por vez (nunca intervalo acumulando ticks).
 * `id` null = nada a acompanhar; `initial` evita a 1ª consulta quando o pedido já devolveu o estado.
 */
export function useSaverExtraction(id: string | null, initial?: SaverExtraction | null): SaverExtractionState {
  const [extraction, setExtraction] = useState<SaverExtraction | null>(initial && initial.id === id ? initial : null);
  const [error, setError] = useState<SaverError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!id) {
      setExtraction(null);
      return;
    }
    let stopped = false;
    const seed = initialRef.current?.id === id ? initialRef.current : null;
    setExtraction(seed);
    setError(null);

    const schedule = () => {
      if (!stopped) timer.current = setTimeout(() => void tick(), SAVER_EXTRACTION_POLL_MS);
    };
    const tick = async () => {
      try {
        const next = await saverService.getExtraction(id);
        if (stopped) return;
        setExtraction(next);
        if (isExtractionActive(next.status)) schedule();
      } catch (err) {
        if (stopped) return;
        setError(describeSaverError(err));
      }
    };

    if (seed && !isExtractionActive(seed.status)) return () => { stopped = true; };
    if (seed) schedule();
    else void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  const cancel = useCallback(async () => {
    if (!id) return;
    try {
      setExtraction(await saverService.cancelExtraction(id));
    } catch (err) {
      setError(describeSaverError(err));
    }
  }, [id]);

  return { extraction, error, active: extraction ? isExtractionActive(extraction.status) : false, cancel };
}
