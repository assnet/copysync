import { useEffect, useMemo, useRef, useState } from 'react';
import { storefrontService } from '@/services/storefront.service';
import { toPreviewDraft, type StorefrontFormState } from '../storefrontForm';
import type { StorefrontViewport } from '../types';

/** Espera depois da última tecla antes de pedir a prévia (a rota tem rate limit). */
export const PREVIEW_DEBOUNCE_MS = 500;

export interface StorefrontPreviewState {
  /** Último html bom; null até a primeira resposta. */
  html: string | null;
  loading: boolean;
  /** A última tentativa falhou (o html anterior continua na tela). */
  error: boolean;
}

/**
 * Prévia do rascunho (`POST /storefront/preview`): debounce, uma chamada por rascunho distinto e
 * só a resposta mais recente vale — resposta atrasada de um rascunho anterior é descartada.
 */
export function useStorefrontPreview(draft: StorefrontFormState, viewport: StorefrontViewport): StorefrontPreviewState {
  const body = useMemo(() => toPreviewDraft(draft), [draft]);
  // chave por valor: rerender com objeto novo e mesmo conteúdo não pede de novo
  const key = JSON.stringify([body, viewport]);
  const [state, setState] = useState<StorefrontPreviewState>({ html: null, loading: false, error: false });
  const seq = useRef(0);
  const latest = useRef({ body, viewport });
  latest.current = { body, viewport };

  useEffect(() => {
    const timer = setTimeout(() => {
      const id = ++seq.current;
      const { body: b, viewport: v } = latest.current;
      setState((s) => ({ ...s, loading: true }));
      storefrontService.preview(b, v).then(
        (html) => { if (id === seq.current) setState({ html, loading: false, error: false }); },
        () => { if (id === seq.current) setState((s) => ({ ...s, loading: false, error: true })); },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);

  // desmontou: nenhuma resposta pendente escreve no estado
  useEffect(() => () => { seq.current += 1; }, []);

  return state;
}
